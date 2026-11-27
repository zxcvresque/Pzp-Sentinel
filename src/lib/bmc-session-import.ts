import { randomUUID } from "node:crypto";
import { load } from "cheerio";
import { bmcAccountSlug } from "./bmc-attribution";
import { bmcDashboardSession, BmcHistoryError, fetchBmcDashboardJson } from "./bmc-history";
import { fetchBmcSubscriptions, parseBmcOneTimeHistory } from "./bmc-account-history";
import { mutateBmcSession } from "./bmc-private-store";

const invalid = () => new BmcHistoryError("INVALID_SESSION_INPUT", "Paste the Cookie value or copied request headers from Helium DevTools. Do not paste JavaScript or response headers.", 400);
export function parseBmcSessionHeaders(raw: unknown) {
  if (typeof raw !== "string" || raw.length > 32768 || !raw.trim() || /\0/.test(raw)) throw invalid();
  const text = raw.trim();
  const lines = text.split(/\r?\n/);
  const header = (name: string) => {
    const values: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.toLowerCase() === name) values.push(lines[i + 1]?.trim() || "");
      else if (line.toLowerCase().startsWith(`${name}:`)) values.push(line.slice(name.length + 1).trim());
    }
    if (values.length > 1) throw invalid();
    return values[0];
  };
  const cookie = header("cookie") || (lines.length === 1 && !/^\s*(fetch\(|curl |set-cookie:)/i.test(text) ? text : "");
  if (!cookie || cookie.length > 16000 || /[\r\n\x00-\x1f\x7f]/.test(cookie)) throw invalid();
  const names = new Set<string>();
  const values = cookie.split(/;\s*/);
  for (const pair of values) {
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (separator < 1 || !/^[!#$%&'*+.^_`|~a-zA-Z0-9-]+$/.test(name) || /[\s"\\]/.test(value) || names.has(name)) throw invalid();
    names.add(name);
  }
  let xsrfToken = header("x-xsrf-token");
  if (!xsrfToken) {
    const xsrf = values.find(pair => pair.startsWith("XSRF-TOKEN="));
    if (xsrf) { try { xsrfToken = decodeURIComponent(xsrf.slice("XSRF-TOKEN=".length)); } catch { throw invalid(); } }
  }
  if (xsrfToken && (xsrfToken.length > 16000 || /[\r\n\x00-\x1f\x7f]/.test(xsrfToken))) throw invalid();
  return { cookie, ...(xsrfToken ? { xsrfToken } : {}) };
}

export function parseBmcSessionToken(raw: unknown) {
  if (typeof raw !== "string" || raw.length > 65536) throw invalid();
  let token;
  try { token = JSON.parse(raw); } catch { throw new BmcHistoryError("INVALID_SESSION_TOKEN", "Paste the complete session value copied by the Helium extractor.", 400); }
  if (token?.format !== "sentinel-bmc-session" || token.version !== 1) throw new BmcHistoryError("INVALID_SESSION_TOKEN", "This is not a supported Helium BMC session value.", 400);
  return { app: parseBmcSessionHeaders(token.appCookie), studio: parseBmcSessionHeaders(token.studioCookie) };
}

export async function bmcConnectionStatus() {
  try {
    const session = await bmcDashboardSession();
    return { connected: session.accountSlug === bmcAccountSlug() && Boolean(session.studioCookie && session.generation), connectedAt: session.connectedAt || null, accountSlug: bmcAccountSlug() };
  } catch { return { connected: false, connectedAt: null, accountSlug: bmcAccountSlug() }; }
}

/** Validate both origins and creator ownership before replacing any working session. */
export async function importBmcSession(owner: string, appHeaders: unknown, studioHeaders: unknown, fetcher: typeof fetch = fetch, sessionToken?: unknown) {
  const slug = bmcAccountSlug();
  if (slug === "current") throw new BmcHistoryError("ACCOUNT_NOT_CONFIGURED", "Configure BMC_ACCOUNT_SLUG before importing a session.", 503);
  const { app, studio } = sessionToken !== undefined ? parseBmcSessionToken(sessionToken) : { app: parseBmcSessionHeaders(appHeaders), studio: parseBmcSessionHeaders(studioHeaders) };
  const candidate = { ...app, studioCookie: studio.cookie };
  let response: Response;
  try {
    response = await fetcher("https://studio.buymeacoffee.com/dashboard", { method: "GET", headers: { Cookie: studio.cookie, Accept: "text/html" }, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15000) });
  } catch { throw new BmcHistoryError("PROVIDER_UNAVAILABLE", "BMC could not be reached. Your existing session has not been replaced.", 503); }
  if ([301, 302, 303, 307, 308, 401, 419].includes(response.status)) throw new BmcHistoryError("SESSION_EXPIRED", "The studio session has expired. Copy fresh request headers from Helium while signed in.", 409);
  if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) throw new BmcHistoryError("PROVIDER_ACCESS_DENIED", "BMC did not accept the studio session. Copy fresh request headers and try again.", 409);
  const html = await response.text();
  if (html.length > 5_000_000) throw new BmcHistoryError("INVALID_PROVIDER_DATA", "BMC returned an unexpected dashboard response.");
  const $ = load(html);
  const matches = $("a[href]").toArray().some(element => {
    try {
      const url = new URL($(element).attr("href") || "", "https://studio.buymeacoffee.com/dashboard");
      return url.protocol === "https:" && !url.username && !url.password && !url.port && ["buymeacoffee.com", "www.buymeacoffee.com"].includes(url.hostname) && url.pathname.replace(/\/$/, "").toLowerCase() === `/${slug}`;
    } catch { return false; }
  });
  if (!matches) throw new BmcHistoryError("ACCOUNT_MISMATCH", `The imported studio session does not show the configured creator account (${slug}). Sign in to that BMC account and copy its request headers.`, 409);
  // Both cookie sets must belong to this same creator, not a mixed pair.
  const [appSubscriptions, studioSubscriptions] = await Promise.all([
    fetchBmcSubscriptions(1, { session: candidate, fetcher }),
    fetchBmcSubscriptions(1, { session: { cookie: studio.cookie, xsrfToken: studio.xsrfToken }, fetcher }),
  ]);
  const fingerprint = (result: typeof appSubscriptions) => JSON.stringify({ rows: result.subscriptions.slice().sort((a, b) => a.id.localeCompare(b.id)), hasMore: result.hasMore });
  if (!appSubscriptions.subscriptions.length || fingerprint(appSubscriptions) !== fingerprint(studioSubscriptions)) throw new BmcHistoryError("SESSION_IDENTITY_UNVERIFIED", "The app and studio sessions could not be matched to the same creator account. Copy both request headers from the same signed-in Helium session.", 409);
  parseBmcOneTimeHistory(await fetchBmcDashboardJson("https://studio.buymeacoffee.com/api/supporters/onetime?page=1", { session: candidate, fetcher }));
  const session = { ...candidate, connectedAt: new Date().toISOString(), connectedBy: owner, accountSlug: slug, generation: randomUUID() };
  await mutateBmcSession(() => session);
  return { connected: true, connectedAt: session.connectedAt, accountSlug: slug };
}

export async function disconnectBmcSession() { await mutateBmcSession(() => null); }
