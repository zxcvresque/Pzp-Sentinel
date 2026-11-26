import { readFile } from "node:fs/promises";
import { decryptSecret } from "./secret-crypto";
import { mutateBmcSession } from "./bmc-private-store";

export class BmcHistoryError extends Error {
  constructor(public code: string, message: string, public status = 502) { super(message); }
}

export type BmcDashboardSession = { cookie: string; xsrfToken?: string; studioCookie?: string; connectedAt?: string; connectedBy?: string; accountSlug?: string; generation?: string };
type Session = BmcDashboardSession;
type RecordValue = Record<string, unknown>;
function object(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function identifier(value: unknown) {
  const id = String(value ?? "");
  if (!/^[1-9]\d{0,17}$/.test(id)) throw new BmcHistoryError("INVALID_ID", "Use a numeric BMC subscription ID.", 400);
  return id;
}
function decimal(value: unknown) {
  const text = String(value ?? "");
  if (!/^\d+(\.\d+)?$/.test(text) || !Number.isFinite(Number(text))) throw new BmcHistoryError("INVALID_PROVIDER_DATA", "BMC returned an invalid payment amount.");
  return text;
}

export async function bmcDashboardSession(): Promise<Session> {
  try {
    // Runtime credentials must never be copied into a Next.js build trace.
    const stored = await readFile(/* turbopackIgnore: true */ process.env.BMC_DASHBOARD_SESSION_FILE || "data/bmc-dashboard/session.enc", "utf8");
    // Refuse plaintext session storage.
    if (!stored.startsWith("enc:v1:")) throw Error();
    const session = JSON.parse(decryptSecret(stored.trim()));
    if (!session.cookie || typeof session.cookie !== "string" || /[\r\n]/.test(session.cookie)) throw Error();
    if (session.xsrfToken && (typeof session.xsrfToken !== "string" || /[\r\n]/.test(session.xsrfToken))) throw Error();
    return session;
  } catch {
    throw new BmcHistoryError("SESSION_NOT_CONFIGURED", "Connect your BMC account in Sentinel → Transactions → BMC connection.", 503);
  }
}

function normalize(row: unknown, subscriptionId: string) {
  if (!object(row) || String(row.fk_subscription_id) !== subscriptionId) throw new BmcHistoryError("INVALID_PROVIDER_DATA", "BMC returned a mismatched subscription record.");
  if (!/^[1-9]\d{0,17}$/.test(String(row.support_id ?? ""))) throw new BmcHistoryError("INVALID_PROVIDER_DATA", "BMC returned an invalid charge ID.");
  const supportId = String(row.support_id);
  if (typeof row.transaction_id !== "string" || !row.transaction_id || row.transaction_id.length > 256) throw new BmcHistoryError("INVALID_PROVIDER_DATA", "BMC returned no payment reference.");
  const date = typeof row.support_created_on === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(row.support_created_on) ? new Date(row.support_created_on) : null;
  if (!date || !Number.isFinite(date.getTime())) throw new BmcHistoryError("INVALID_PROVIDER_DATA", "BMC returned an invalid payment date.");
  if (typeof row.support_currency !== "string" || !/^[A-Z]{3}$/.test(row.support_currency)) throw new BmcHistoryError("INVALID_PROVIDER_DATA", "BMC returned an invalid currency.");
  const refunded = row.is_refunded === true || row.is_refunded === 1 || row.is_refunded === "1" || row.is_refunded === "true";
  if (![null, undefined, true, false, 0, 1, "0", "1", "true", "false"].includes(row.is_refunded as never)) throw new BmcHistoryError("INVALID_PROVIDER_DATA", "BMC returned an unknown refund flag.");
  return {
    id: `bmc-history:${supportId}`, supportId, subscriptionId,
    paymentId: row.transaction_id,
    amount: decimal(row.support_total_charged_amount), currency: row.support_currency,
    occurredAt: date.toISOString(),
    refundStatus: refunded ? "REFUNDED" : row.is_refunded === null || row.is_refunded === undefined ? "NOT_REPORTED" : "NOT_REFUNDED",
    evidenceSource: "BMC_RENEWAL_HISTORY",
    // This endpoint reports what BMC's dashboard records. It does not claim to
    // have independently fetched the Stripe PaymentIntent's capture status.
    state: refunded ? "REFUNDED" : "RECORDED",
  };
}

export async function fetchBmcRenewalHistory(rawId: string, page = 1, options?: { session?: Session; fetcher?: typeof fetch }) {
  const subscriptionId = identifier(rawId);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new BmcHistoryError("INVALID_PAGE", "page must be an integer from 1 to 10000.", 400);
  const data = await fetchBmcDashboardJson(`https://app.buymeacoffee.com/api/v1/subscriptions/${subscriptionId}/renewal_history?page=${page}`, options);
  if (!object(data) || !Array.isArray(data.data) || !object(data.meta)) throw new BmcHistoryError("INVALID_PROVIDER_DATA", "BMC history format changed. Manual review is required.");
  const { current_page: currentPage, last_page: lastPage, total } = data.meta;
  if (currentPage !== page || !Number.isSafeInteger(lastPage) || Number(lastPage) < page || Number(lastPage) > 10000 || !Number.isSafeInteger(total) || Number(total) < 0 || data.data.length > 1000) throw new BmcHistoryError("INVALID_PROVIDER_DATA", "BMC returned inconsistent pagination.");
  const payments = data.data.map(row => normalize(row, subscriptionId));
  if (new Set(payments.map(row => row.supportId)).size !== payments.length) throw new BmcHistoryError("INVALID_PROVIDER_DATA", "BMC returned duplicate payment records.");
  return { subscriptionId, payments, page, total, hasMore: page < Number(lastPage), nextPage: page < Number(lastPage) ? page + 1 : null, fetchedAt: new Date().toISOString(), source: "BMC_DASHBOARD", readOnly: true };
}

/** Internal only: callers construct fixed provider endpoints, never accept a URL from clients. */
export async function fetchBmcDashboardJson(url: string, options?: { session?: Session; fetcher?: typeof fetch }) {
  const target = new URL(url);
  if (target.protocol !== "https:" || !["app.buymeacoffee.com", "studio.buymeacoffee.com"].includes(target.hostname) || target.port || target.username || target.password) throw new BmcHistoryError("INVALID_URL", "Invalid BMC endpoint.", 400);
  const session = options?.session || await bmcDashboardSession();
  const cookie = target.hostname === "studio.buymeacoffee.com" ? session.studioCookie : session.cookie;
  if (!cookie || /[\r\n]/.test(cookie)) throw new BmcHistoryError("SESSION_EXPIRED", "Reconnect BMC in Sentinel to read the complete account history.", 503);
  const fetcher = options?.fetcher || fetch;
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET", headers: { Accept: "application/json", Cookie: cookie, "X-Requested-With": "XMLHttpRequest",
        Origin: "https://studio.buymeacoffee.com", Referer: "https://studio.buymeacoffee.com/",
        ...(session.xsrfToken ? { "X-XSRF-TOKEN": session.xsrfToken } : {}),
      }, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15000),
    });
  } catch { throw new BmcHistoryError("PROVIDER_UNAVAILABLE", "BMC history could not be reached. Try again later.", 503); }
  // Persist provider-issued rotations, never credentials supplied by a caller.
  // Imported/legacy sessions remain read-only until connected through Sentinel.
  if (session.generation && response.ok && !options?.fetcher) {
    const rotations = response.headers.getSetCookie();
    if (rotations.length) {
      await mutateBmcSession<Session>(async current => {
        if (!current || current.generation !== session.generation) return current;
        const latest = { ...current };
        const field = target.hostname === "studio.buymeacoffee.com" ? "studioCookie" : "cookie";
        const jar = new Map((latest[field] || "").split("; ").filter(Boolean).map(pair => { const i = pair.indexOf("="); return [pair.slice(0, i), pair.slice(i + 1)] as const; }));
        for (const rotation of rotations) {
          const pair = rotation.split(";", 1)[0];
          const separator = pair.indexOf("=");
          if (separator < 1 || /[\r\n]/.test(pair)) continue;
          const name = pair.slice(0, separator);
          const value = pair.slice(separator + 1);
          if (/;\s*max-age=0(?:;|$)/i.test(rotation)) jar.delete(name); else jar.set(name, value);
          if (name === "XSRF-TOKEN" && field === "cookie") { try { latest.xsrfToken = decodeURIComponent(value); } catch { /* Keep last token. */ } }
        }
        latest[field] = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
        // Subsequent pages in this run must use the rotated session as well.
        Object.assign(session, latest);
        return latest;
      });
    }
  }
  if ([301, 302, 303, 307, 308, 401, 419].includes(response.status)) throw new BmcHistoryError("SESSION_EXPIRED", "Reconnect the BMC dashboard session.", 503);
  if (response.status === 403) throw new BmcHistoryError("PROVIDER_ACCESS_DENIED", "BMC denied access. Check the dashboard session and account permissions.", 503);
  if (response.status === 429) throw new BmcHistoryError("PROVIDER_RATE_LIMIT", "BMC rate limited history reads. Try again later.", 503);
  if (response.status === 404) throw new BmcHistoryError("HISTORY_NOT_FOUND", "Subscription history is unavailable for this account.", 404);
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new BmcHistoryError("PROVIDER_UNAVAILABLE", "BMC returned no readable payment history.", 503);
  let data: unknown;
  try { data = await response.json(); } catch { throw new BmcHistoryError("INVALID_PROVIDER_DATA", "BMC returned invalid history JSON."); }
  return data;
}
