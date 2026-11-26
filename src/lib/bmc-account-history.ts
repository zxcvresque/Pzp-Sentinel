import { load } from "cheerio";
import { BmcHistoryError, fetchBmcDashboardJson, fetchBmcRenewalHistory, type BmcDashboardSession } from "./bmc-history";

export type BmcSubscription = {
  id: string; stripeId: string; supporterId: string;
  status: "ACTIVE" | "PAUSED" | "CANCELLING" | "CANCELLED";
  cancelled: boolean; cancelAtPeriodEnd: boolean; paused: boolean;
  cancelledAt: string | null; renewalAt: string | null;
  lastSeenAt?: string; missingFromLatestCheck?: boolean;
};
export type BmcAccountPayment = {
  id: string; supportId: string; subscriptionId: string | null; paymentId: string | null;
  amount: string; currency: string; occurredAt: string; refundStatus: string; state: string;
  evidenceSource: string; supporterId: string; stripeSubscriptionId: string | null;
  frequency: "MONTHLY" | "ONE_TIME";
};
type Options = { session?: BmcDashboardSession; fetcher?: typeof fetch };
const invalid = () => new BmcHistoryError("INVALID_PROVIDER_DATA", "BMC history format changed. Reconnect or ask an admin to review it.");
const numericId = (value: unknown) => /^[1-9]\d{0,17}$/.test(String(value ?? ""));
function providerFlag(value: unknown) {
  if (![null, 0, 1, false, true, "0", "1"].includes(value as never)) throw invalid();
  return value === 1 || value === "1" || value === true;
}
function providerDate(value: unknown) {
  if (value === null) return null;
  // BMC's lifecycle timestamps do not specify a zone. Preserve them verbatim.
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\d(?:[ T]\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?)?$/.test(value)) throw invalid();
  return value;
}

export async function fetchBmcSubscriptions(page = 1, options?: Options) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new BmcHistoryError("INVALID_PAGE", "Invalid page.", 400);
  const body = await fetchBmcDashboardJson(`https://app.buymeacoffee.com/api/v1/subscriptions?type=2&page=${page}`, options) as { data?: Record<string, unknown>[]; meta?: { current_page: number }; links?: { next: string | null } };
  if (!body || !Array.isArray(body.data) || body.meta?.current_page !== page || !body.links || !(body.links.next === null || typeof body.links.next === "string") || body.data.length > 1000) throw invalid();
  const subscriptions: BmcSubscription[] = body.data.map(row => {
    if (!numericId(row.id) || !numericId(row.fk_user_id_payer) || typeof row.psp_id !== "string" || !/^sub_[a-zA-Z0-9]+$/.test(row.psp_id)) throw invalid();
    const cancelled = providerFlag(row.subscription_is_cancelled);
    const cancelAtPeriodEnd = providerFlag(row.subscription_is_cancelled_at_period_end);
    const paused = providerFlag(row.is_paused);
    const status = cancelAtPeriodEnd ? "CANCELLING" : cancelled ? "CANCELLED" : paused ? "PAUSED" : "ACTIVE";
    return { id: String(row.id), stripeId: row.psp_id, supporterId: String(row.fk_user_id_payer), cancelled, cancelAtPeriodEnd, paused, status,
      cancelledAt: providerDate(row.subscription_cancelled_on), renewalAt: providerDate(row.renewal_on) };
  });
  if (new Set(subscriptions.map(row => row.id)).size !== subscriptions.length || (body.links.next && !subscriptions.length)) throw invalid();
  // Never follow URLs supplied by the provider; construct page + 1 ourselves.
  return { subscriptions, page, hasMore: body.links.next !== null };
}

export function parseBmcOneTimeHistory(body: unknown): BmcAccountPayment[] {
  if (!body || typeof body !== "object" || !("view" in body) || typeof body.view !== "string" || body.view.length > 5_000_000) throw invalid();
  const $ = load(`<table><tbody>${body.view}</tbody></table>`);
  const rows = $("tr.mdata-tr");
  // A changed template must never masquerade as an empty account.
  if (!rows.length && body.view.trim() && !/no (supporters|transactions|records|results)/i.test($("body").text())) throw invalid();
  return rows.toArray().map(element => {
    const row = $(element);
    const supportId = row.attr("data-id") || "";
    const supporterId = row.find("input.supporter-id").attr("value") || "";
    const amount = row.find("input.amt").attr("value") || "";
    const currency = row.find('input[data-mdata-name="psp-currency"]').attr("value") || "";
    const date = row.find('input[data-mdata-name="date"]').attr("value") || "";
    const refund = row.find("input.mdata-refund-status").attr("value");
    const references = [...new Set(row.find("input").toArray().flatMap(input => {
      const value = $(input).attr("value") || "";
      return /^(pi_|ch_)[a-zA-Z0-9]+$/.test(value) ? [value] : [];
    }))];
    // Dashboard dates have day precision. Do not invent an actual capture time.
    const occurredAt = new Date(`${date} 00:00:00 GMT`);
    if (!numericId(supportId) || !numericId(supporterId) || !/^\d+(\.\d+)?$/.test(amount) || !Number.isFinite(Number(amount)) || !/^[A-Z]{3}$/.test(currency) || !/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(date) || !Number.isFinite(occurredAt.getTime()) || !["", "0", "1"].includes(refund ?? "unknown") || references.length > 1) throw invalid();
    return { id: `bmc-history:${supportId}`, supportId, supporterId, subscriptionId: null, stripeSubscriptionId: null,
      paymentId: references[0] || null, amount, currency, occurredAt: occurredAt.toISOString(),
      refundStatus: refund === "1" ? "REFUNDED" : refund === "0" ? "NOT_REFUNDED" : "NOT_REPORTED",
      state: refund === "1" ? "REFUNDED" : "RECORDED", frequency: "ONE_TIME", evidenceSource: "BMC_ONE_TIME_HISTORY" };
  });
}

export async function fetchEntireBmcAccountHistory(session?: BmcDashboardSession, fetcher?: typeof fetch) {
  const options = { session, fetcher };
  const subscriptions: BmcSubscription[] = [];
  const payments: BmcAccountPayment[] = [];
  const seen = new Set<string>();
  const paymentIds = new Set<string>();
  const deadline = Date.now() + 12 * 60_000;
  const guard = () => { if (Date.now() > deadline) throw new BmcHistoryError("SYNC_TIMEOUT", "History sync exceeded its time limit. The last complete history is retained.", 503); };
  for (let page = 1; ; page++) {
    guard();
    const result = await fetchBmcSubscriptions(page, options);
    for (const subscription of result.subscriptions) {
      if (subscriptions.some(row => row.id === subscription.id)) throw invalid();
      subscriptions.push(subscription);
    }
    if (!result.hasMore) break;
  }
  for (const subscription of subscriptions) {
    let count = 0;
    let total: number | null = null;
    for (let page = 1; ; page++) {
      guard();
      const history = await fetchBmcRenewalHistory(subscription.id, page, options);
      if (total !== null && history.total !== total) throw invalid();
      total = Number(history.total);
      for (const payment of history.payments) {
        if (seen.has(payment.id) || paymentIds.has(payment.paymentId)) throw invalid();
        seen.add(payment.id);
        paymentIds.add(payment.paymentId);
        payments.push({ ...payment, supporterId: subscription.supporterId, stripeSubscriptionId: subscription.stripeId, frequency: "MONTHLY" });
        count++;
      }
      if (!history.hasMore) break;
    }
    if (count !== total) throw invalid();
  }
  for (let page = 1; page <= 10000; page++) {
    guard();
    const rows = parseBmcOneTimeHistory(await fetchBmcDashboardJson(`https://studio.buymeacoffee.com/api/supporters/onetime?page=${page}`, options));
    if (!rows.length) return { subscriptions, payments, fetchedAt: new Date().toISOString(), coverage: ["MONTHLY_SUPPORT", "ONE_TIME_SUPPORT"] as const };
    for (const row of rows) {
      if (seen.has(row.id) || (row.paymentId && paymentIds.has(row.paymentId))) throw invalid();
      seen.add(row.id);
      if (row.paymentId) paymentIds.add(row.paymentId);
      payments.push(row);
    }
  }
  throw invalid();
}
