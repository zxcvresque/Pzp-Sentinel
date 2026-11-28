import { load } from "cheerio";
import { BmcHistoryError, bmcFormatError, fetchBmcDashboardJson, fetchBmcRenewalHistory, provenSupporterPayment, type BmcDashboardSession } from "./bmc-history";

export type BmcSubscription = {
  id: string; stripeId: string; supporterId: string;
  status: "ACTIVE" | "PAUSED" | "CANCELLING" | "CANCELLED";
  cancelled: boolean; cancelAtPeriodEnd: boolean; paused: boolean;
  cancelledAt: string | null; renewalAt: string | null;
  lastSeenAt?: string; missingFromLatestCheck?: boolean;
  /** The subscription's price in the supporter's currency (display evidence only). */
  supporterPrice?: { amount: string | null; currency: string | null };
};
export type BmcAccountPayment = {
  id: string; supportId: string; subscriptionId: string | null; paymentId: string | null;
  amount: string; currency: string; occurredAt: string; refundStatus: string; state: string;
  evidenceSource: string; supporterId: string; stripeSubscriptionId: string | null;
  frequency: "MONTHLY" | "ONE_TIME";
  /** What the supporter paid in their own currency, when BMC's exchange rate proves it. Display only. */
  supporterPaid?: { amount: string; currency: string } | null;
};
type Options = { session?: BmcDashboardSession; fetcher?: typeof fetch };
// Every rejection names the failed check so an admin can tell a template change
// from a pagination or duplicate problem. Never include provider values.
const invalid = (detail: string) => bmcFormatError(detail);
const numericId = (value: unknown) => /^[1-9]\d{0,17}$/.test(String(value ?? ""));
function providerFlag(value: unknown, field: string) {
  if (![null, 0, 1, false, true, "0", "1"].includes(value as never)) throw invalid(`subscription list: unknown ${field} value`);
  return value === 1 || value === "1" || value === true;
}
function providerDate(value: unknown, field: string) {
  if (value === null || value === undefined) return null;
  // BMC's lifecycle timestamps do not specify a zone. Preserve them verbatim.
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\d(?:[ T]\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?)?$/.test(value)) throw invalid(`subscription list: invalid ${field} format`);
  return value;
}

export async function fetchBmcSubscriptions(page = 1, options?: Options) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new BmcHistoryError("INVALID_PAGE", "Invalid page.", 400);
  const body = await fetchBmcDashboardJson(`https://app.buymeacoffee.com/api/v1/subscriptions?type=2&page=${page}`, options) as { data?: Record<string, unknown>[]; meta?: { current_page: number }; links?: { next: string | null } };
  if (!body || !Array.isArray(body.data) || body.data.length > 1000) throw invalid(`subscription list page ${page}: missing data array`);
  if (Number(body.meta?.current_page) !== page) throw invalid(`subscription list page ${page}: current_page mismatch`);
  if (!body.links || !(body.links.next === null || typeof body.links.next === "string")) throw invalid(`subscription list page ${page}: missing links.next`);
  const subscriptions: BmcSubscription[] = body.data.map((row, index) => {
    if (!numericId(row.id)) throw invalid(`subscription list page ${page} row ${index + 1}: invalid id`);
    if (!numericId(row.fk_user_id_payer)) throw invalid(`subscription ${row.id}: invalid fk_user_id_payer`);
    if (typeof row.psp_id !== "string" || !/^sub_[a-zA-Z0-9]+$/.test(row.psp_id)) throw invalid(`subscription ${row.id}: psp_id is not a Stripe subscription`);
    const cancelled = providerFlag(row.subscription_is_cancelled, "subscription_is_cancelled");
    const cancelAtPeriodEnd = providerFlag(row.subscription_is_cancelled_at_period_end, "subscription_is_cancelled_at_period_end");
    const paused = providerFlag(row.is_paused, "is_paused");
    const status = cancelAtPeriodEnd ? "CANCELLING" : cancelled ? "CANCELLED" : paused ? "PAUSED" : "ACTIVE";
    return { id: String(row.id), stripeId: row.psp_id, supporterId: String(row.fk_user_id_payer), cancelled, cancelAtPeriodEnd, paused, status,
      cancelledAt: providerDate(row.subscription_cancelled_on, "subscription_cancelled_on"), renewalAt: providerDate(row.renewal_on, "renewal_on"),
      supporterPrice: { amount: typeof row.psp_subscription_price === "string" ? row.psp_subscription_price : null,
        currency: typeof row.psp_subscription_currency === "string" ? row.psp_subscription_currency : null } };
  });
  if (new Set(subscriptions.map(row => row.id)).size !== subscriptions.length) throw invalid(`subscription list page ${page}: duplicate subscription id`);
  if (body.links.next && !subscriptions.length) throw invalid(`subscription list page ${page}: empty page with a next link`);
  // Never follow URLs supplied by the provider; construct page + 1 ourselves.
  return { subscriptions, page, hasMore: body.links.next !== null };
}

const ACCOUNT_CURRENCY: Record<string, string> = { "$": "USD", "₹": "INR" };

export function parseBmcOneTimeHistory(body: unknown, page = 1): BmcAccountPayment[] {
  if (!body || typeof body !== "object" || !("view" in body) || typeof body.view !== "string" || body.view.length > 5_000_000) throw invalid(`one-time history page ${page}: missing view`);
  const $ = load(`<table><tbody>${body.view}</tbody></table>`);
  const rows = $("tr.mdata-tr");
  // A changed template must never masquerade as an empty account.
  if (!rows.length && body.view.trim() && !/no (supporters|transactions|records|results)/i.test($("body").text())) {
    // A signed-out studio session renders a login prompt inside the JSON view.
    if ($("input[type=password], form[action*='login']").length || /\b(sign|log) ?in\b/i.test($("body").text())) throw new BmcHistoryError("SESSION_EXPIRED", "BMC studio returned a sign-in page. Import a fresh Helium session.", 503, `one-time history page ${page}: signed out`);
    throw invalid(`one-time history page ${page}: unrecognised template`);
  }
  return rows.toArray().map((element, index) => {
    const row = $(element);
    const supportId = row.attr("data-id") || "";
    const supporterId = row.find("input.supporter-id").attr("value") || "";
    // `amt` is what BMC credited to the account, in the account currency shown
    // by `currency-symbol` ($). `psp-currency` / `converted-amt` are what the
    // supporter paid (e.g. ₹2,500.00 -> $25.85). Never pair `amt` with the
    // supporter's currency.
    const amount = row.find("input.amt").attr("value") || "";
    const currency = ACCOUNT_CURRENCY[row.find('input.currency-symbol').attr("value") || ""] || "";
    const paidCurrency = row.find('input[data-mdata-name="psp-currency"]').attr("value") || "";
    const paidAmount = (row.find('input.converted-amt').attr("value") || "").replace(/^[^\d]+/, "").replace(/,/g, "");
    const rate = row.find('input.exchange-rate').attr("value") || "";
    const date = row.find('input[data-mdata-name="date"]').attr("value") || "";
    const refund = row.find("input.mdata-refund-status").attr("value");
    const values = row.find("input").toArray().map(input => $(input).attr("value") || "");
    // A row may expose both the PaymentIntent and its Charge for the same
    // payment. Prefer the PaymentIntent (what BMC webhooks report); two
    // different references of the same kind are genuinely ambiguous.
    const intents = [...new Set(values.filter(value => /^pi_[a-zA-Z0-9]+$/.test(value)))];
    const charges = [...new Set(values.filter(value => /^ch_[a-zA-Z0-9]+$/.test(value)))];
    const where = `one-time history page ${page} row ${index + 1}`;
    // Dashboard dates have day precision. Do not invent an actual capture time.
    const occurredAt = new Date(`${date} 00:00:00 GMT`);
    if (!numericId(supportId)) throw invalid(`${where}: invalid data-id`);
    if (!numericId(supporterId)) throw invalid(`${where}: invalid supporter-id`);
    if (!/^\d+(\.\d+)?$/.test(amount) || !Number.isFinite(Number(amount))) throw invalid(`${where}: invalid amount`);
    if (!currency) throw invalid(`${where}: unknown account currency symbol`);
    if (!/^[A-Z]{3}$/.test(paidCurrency)) throw invalid(`${where}: invalid psp-currency`);
    if (!/^\d+(\.\d+)?$/.test(paidAmount) || !/^\d+(\.\d+)?$/.test(rate) || !(Number(rate) > 0)) throw invalid(`${where}: invalid converted-amt or exchange-rate`);
    // Proves the reading above: account amount x rate must equal what the
    // supporter paid (rounding only). Same currency must mean rate 1.
    const supporterPaid = provenSupporterPayment(amount, currency, paidCurrency, paidAmount, rate);
    if (!supporterPaid) throw invalid(`${where}: amt, exchange-rate and converted-amt disagree`);
    if (!/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(date) || !Number.isFinite(occurredAt.getTime())) throw invalid(`${where}: invalid date format`);
    if (!["", "0", "1"].includes(refund ?? "unknown")) throw invalid(`${where}: unknown refund status`);
    if (intents.length > 1 || charges.length > 1) throw invalid(`${where}: multiple payment references`);
    const references = intents.length ? intents : charges;
    return { id: `bmc-history:${supportId}`, supportId, supporterId, subscriptionId: null, stripeSubscriptionId: null,
      paymentId: references[0] || null, amount, currency, occurredAt: occurredAt.toISOString(),
      refundStatus: refund === "1" ? "REFUNDED" : refund === "0" ? "NOT_REFUNDED" : "NOT_REPORTED",
      state: refund === "1" ? "REFUNDED" : "RECORDED", frequency: "ONE_TIME", evidenceSource: "BMC_ONE_TIME_HISTORY", supporterPaid };
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
      if (subscriptions.some(row => row.id === subscription.id)) throw invalid(`subscription list page ${page}: subscription ${subscription.id} repeated across pages`);
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
      if (total !== null && history.total !== total) throw invalid(`monthly history subscription ${subscription.id}: total changed between pages`);
      total = Number(history.total);
      for (const payment of history.payments) {
        if (seen.has(payment.id)) throw invalid(`monthly history subscription ${subscription.id}: support ${payment.supportId} repeated`);
        if (paymentIds.has(payment.paymentId)) throw invalid(`monthly history subscription ${subscription.id}: support ${payment.supportId} reuses another charge's payment reference`);
        seen.add(payment.id);
        paymentIds.add(payment.paymentId);
        // A renewal row's own price is sometimes wrong (seen: "1.040" INR for a ₹100 charge);
        // fall back to the subscription price, again only when the rate proves it.
        const { exchangeRate, ...charge } = payment;
        const supporterPaid = charge.supporterPaid || provenSupporterPayment(charge.amount, charge.currency, subscription.supporterPrice?.currency, subscription.supporterPrice?.amount, exchangeRate);
        payments.push({ ...charge, supporterPaid, supporterId: subscription.supporterId, stripeSubscriptionId: subscription.stripeId, frequency: "MONTHLY" });
        count++;
      }
      if (!history.hasMore) break;
    }
    if (count !== total) throw invalid(`monthly history subscription ${subscription.id}: received ${count} of ${total} charges`);
  }
  for (let page = 1; page <= 10000; page++) {
    guard();
    const rows = parseBmcOneTimeHistory(await fetchBmcDashboardJson(`https://studio.buymeacoffee.com/api/supporters/onetime?page=${page}`, options), page);
    if (!rows.length) return { subscriptions, payments, fetchedAt: new Date().toISOString(), coverage: ["MONTHLY_SUPPORT", "ONE_TIME_SUPPORT"] as const };
    for (const row of rows) {
      if (seen.has(row.id)) throw invalid(`one-time history page ${page}: support ${row.supportId} already seen (repeated page or listed as monthly)`);
      if (row.paymentId && paymentIds.has(row.paymentId)) throw invalid(`one-time history page ${page}: support ${row.supportId} reuses another charge's payment reference`);
      seen.add(row.id);
      if (row.paymentId) paymentIds.add(row.paymentId);
      payments.push(row);
    }
  }
  throw invalid("one-time history: more than 10000 pages");
}
