import { expect, it, vi } from "vitest";
import { fetchBmcSubscriptions, fetchEntireBmcAccountHistory, parseBmcOneTimeHistory } from "./bmc-account-history";
const session = { cookie: "app=private", studioCookie: "studio=private" };
const subscription = { id: 1, fk_user_id_payer: 9, psp_id: "sub_example", subscription_is_cancelled: null, subscription_is_cancelled_at_period_end: null, is_paused: 0, subscription_cancelled_on: null, renewal_on: "2026-12-16 00:16:27" };
const subscriptions = (rows: object[], next: string | null = null, page = 1) => Response.json({ data: rows, meta: { current_page: page }, links: { next } });
const charge = { support_id: 11, fk_subscription_id: 1, transaction_id: "pi_example", support_total_charged_amount: "6.00", support_currency: "USD", support_created_on: "2026-11-16T00:16:27Z", is_refunded: null };
const history = () => Response.json({ data: [charge], meta: { current_page: 1, last_page: 1, total: 1 } });
const money = (amt = "5.00", paid = "USD", converted = "$5.00", rate = "1.000000", symbol = "$") => `<input class="amt" value="${amt}"><input class="currency-symbol" value="${symbol}"><input data-mdata-name="psp-currency" value="${paid}"><input class="converted-amt" value="${converted}"><input class="exchange-rate" value="${rate}">`;
const html = (id = "20", refund = "", amounts = money()) => `<tr class="mdata-tr" data-id="${id}"><td><input class="supporter-id" value="9">${amounts}<input data-mdata-name="date" value="Dec 6, 2024"><input class="mdata-refund-status" value="${refund}"><input data-mdata-name="transaction" value="pi_onetime${id}"></td></tr>`;
it.each([
  [{ subscription_is_cancelled: 1, subscription_cancelled_on: "2026-11-12 10:34:08" }, "CANCELLED"],
  [{ subscription_is_cancelled_at_period_end: 1 }, "CANCELLING"],
  [{ is_paused: 1 }, "PAUSED"], [{}, "ACTIVE"],
])("reads lifecycle flags independently of charges: %j", async (changes, status) => {
  const result = await fetchBmcSubscriptions(1, { session, fetcher: vi.fn().mockResolvedValue(subscriptions([{ ...subscription, ...changes }])) });
  expect(result.subscriptions[0].status).toBe(status);
  expect(JSON.stringify(result)).not.toMatch(/private|supporter_email/);
});
it("does not turn a future renewal date into paid evidence", async () => {
  const result = await fetchBmcSubscriptions(1, { session, fetcher: vi.fn().mockResolvedValue(subscriptions([subscription])) });
  expect(result).not.toHaveProperty("payments");
  expect(result.subscriptions[0].renewalAt).toBe(subscription.renewal_on);
});
it("fails closed on unknown cancellation state or missing fields", async () => {
  for (const changed of [{ subscription_is_cancelled: "active" }, { is_paused: undefined }]) await expect(fetchBmcSubscriptions(1, { session, fetcher: vi.fn().mockResolvedValue(subscriptions([{ ...subscription, ...changed }])) })).rejects.toMatchObject({ code: "INVALID_PROVIDER_DATA" });
});
it("parses observed one-time history without exposing payer details or inferring refund=false", () => {
  expect(parseBmcOneTimeHistory({ view: html() })).toMatchObject([{ supportId: "20", paymentId: "pi_onetime20", amount: "5.00", currency: "USD", refundStatus: "NOT_REPORTED", frequency: "ONE_TIME" }]);
  expect(parseBmcOneTimeHistory({ view: html("20", "1") })[0].state).toBe("REFUNDED");
  expect(parseBmcOneTimeHistory({ view: "" })).toEqual([]);
});
it("records what the supporter paid only when BMC's exchange rate proves it", async () => {
  expect(parseBmcOneTimeHistory({ view: html("20", "", money("25.85", "INR", "₹2,500.00", "96.721153")) })[0].supporterPaid).toEqual({ amount: "2500.00", currency: "INR" });
  // Monthly: a renewal row's own price can be wrong ("1.040" INR for ₹100); fall back to the
  // subscription price, which 1.04 x 96.52 proves. Nothing provable -> null, never a guess.
  const inr = { ...subscription, psp_subscription_currency: "INR", psp_subscription_price: "100.000" };
  const renewal = { ...charge, support_total_charged_amount: "1.04", psp_subscription_currency: "INR", psp_subscription_price: "1.040", exchange_rate: "96.521370" };
  const fetchWith = (sub: object) => fetchEntireBmcAccountHistory(session, vi.fn()
    .mockResolvedValueOnce(subscriptions([sub])).mockResolvedValueOnce(Response.json({ data: [renewal], meta: { current_page: 1, last_page: 1, total: 1 } }))
    .mockResolvedValueOnce(Response.json({ view: "" })));
  expect((await fetchWith(inr)).payments[0]).toMatchObject({ amount: "1.04", currency: "USD", supporterPaid: { amount: "100.00", currency: "INR" } });
  expect((await fetchWith({ ...inr, psp_subscription_price: "500.000" })).payments[0].supporterPaid).toBeNull();
});
it("books a foreign-currency charge at the USD amount BMC credited, not the supporter's currency", () => {
  // Observed live: ₹2,500.00 -> $25.85 and €20.00 -> $22.25.
  expect(parseBmcOneTimeHistory({ view: html("20", "", money("25.85", "INR", "₹2,500.00", "96.721153")) })[0]).toMatchObject({ amount: "25.85", currency: "USD" });
  expect(parseBmcOneTimeHistory({ view: html("20", "", money("22.25", "EUR", "€20.00", "0.898699")) })[0]).toMatchObject({ amount: "22.25", currency: "USD" });
});
it.each([
  ["rate disagrees", money("25.85", "INR", "₹2,500.00", "1.000000")],
  ["same currency but different amounts", money("25.85", "USD", "$2,500.00")],
  ["unknown account currency", money("5.00", "USD", "$5.00", "1.000000", "£")],
  ["missing exchange data", `<input class="amt" value="5.00"><input class="currency-symbol" value="$"><input data-mdata-name="psp-currency" value="USD">`],
])("rejects one-time money it cannot prove: %s", (_, amounts) => {
  expect(() => parseBmcOneTimeHistory({ view: html("20", "", amounts) })).toThrow(/format changed/);
});
it.each([{ view: "<html>Login</html>" }, { view: "<tr class='changed'>Data</tr>" }, { data: [] }])("rejects changed or login templates instead of claiming empty history", body => {
  expect(() => parseBmcOneTimeHistory(body)).toThrow();
});
it("discovers all subscriptions including cancelled ones, exhausts history and one-time pages", async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(subscriptions([subscription], "https://untrusted.example/steal"))
    .mockResolvedValueOnce(subscriptions([{ ...subscription, id: 2, psp_id: "sub_cancelled", subscription_is_cancelled: 1 }], null, 2))
    .mockResolvedValueOnce(history())
    .mockResolvedValueOnce(Response.json({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } }))
    .mockResolvedValueOnce(Response.json({ view: html() }))
    .mockResolvedValueOnce(Response.json({ view: html("21") }))
    .mockResolvedValueOnce(Response.json({ view: "" }));
  const result = await fetchEntireBmcAccountHistory(session, fetcher);
  expect(result.payments).toHaveLength(3);
  expect(result.subscriptions[1].status).toBe("CANCELLED");
  expect(fetcher.mock.calls[1][0]).toBe("https://app.buymeacoffee.com/api/v1/subscriptions?type=2&page=2");
  expect(fetcher.mock.calls.every(([url]) => !String(url).includes("untrusted"))).toBe(true);
});
it("rejects repeated one-time pages instead of looping or duplicating income", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(subscriptions([])).mockImplementation(async () => Response.json({ view: html() }));
  await expect(fetchEntireBmcAccountHistory(session, fetcher)).rejects.toMatchObject({ code: "INVALID_PROVIDER_DATA" });
});
it("a session error aborts the complete fetch rather than returning partial history", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(subscriptions([subscription])).mockResolvedValueOnce(history()).mockResolvedValueOnce(new Response(null, { status: 401 }));
  await expect(fetchEntireBmcAccountHistory(session, fetcher)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
});
