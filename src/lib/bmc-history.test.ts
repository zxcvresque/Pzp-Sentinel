import { afterEach, expect, it, vi } from "vitest";
import { fetchBmcDashboardJson, fetchBmcRenewalHistory } from "./bmc-history";
const session = { cookie: "private-session=secret", xsrfToken: "private-xsrf" };
const row = { support_id: 16368685, fk_subscription_id: 1146135, transaction_id: "pi_example", support_total_charged_amount: "25.00", support_currency: "USD", support_created_on: "2026-11-25T16:06:23.000000Z", is_refunded: null, supporter_email: "never-expose@example.test" };
const envelope = (payments = [row], meta = { current_page: 1, last_page: 1, total: payments.length }) => Response.json({ data: payments, meta, links: { next: "https://untrusted.example" } });
afterEach(() => vi.restoreAllMocks());

it("returns normalized payment references and explicit evidence semantics without account secrets or PII", async () => {
  const fetcher = vi.fn().mockResolvedValue(envelope());
  const history = await fetchBmcRenewalHistory("1146135", 1, { session, fetcher });
  expect(history).toMatchObject({ readOnly: true, hasMore: false, nextPage: null, payments: [{ paymentId: "pi_example", amount: "25.00", currency: "USD", state: "RECORDED", refundStatus: "NOT_REPORTED" }] });
  expect(JSON.stringify(history)).not.toMatch(/secret|private-xsrf|supporter_email|never-expose/);
  expect(fetcher.mock.calls[0][0]).toBe("https://app.buymeacoffee.com/api/v1/subscriptions/1146135/renewal_history?page=1");
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "manual", method: "GET", cache: "no-store" });
});
it("exposes bounded pagination without following provider-controlled links", async () => {
  const fetcher = vi.fn().mockResolvedValue(envelope([row], { current_page: 2, last_page: 3, total: 3 }));
  expect(await fetchBmcRenewalHistory("1146135", 2, { session, fetcher })).toMatchObject({ page: 2, hasMore: true, nextPage: 3 });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toContain("page=2");
});
it.each(["../1", "1?secret", "0", "https://evil.example", "1146135/path"])("rejects invalid subscription ID %s before a request", async id => {
  const fetcher = vi.fn();
  await expect(fetchBmcRenewalHistory(id, 1, { session, fetcher })).rejects.toMatchObject({ code: "INVALID_ID", status: 400 });
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([0, -1, 1.2, 10001])( "rejects invalid page %s", async page => {
  await expect(fetchBmcRenewalHistory("1146135", page, { session, fetcher: vi.fn() })).rejects.toMatchObject({ code: "INVALID_PAGE" });
});
it.each([[302, "SESSION_EXPIRED"], [401, "SESSION_EXPIRED"], [419, "SESSION_EXPIRED"], [403, "PROVIDER_ACCESS_DENIED"], [429, "PROVIDER_RATE_LIMIT"], [404, "HISTORY_NOT_FOUND"]])("reports provider HTTP %s as %s instead of returning empty history", async (status, code) => {
  await expect(fetchBmcRenewalHistory("1146135", 1, { session, fetcher: vi.fn().mockResolvedValue(new Response(null, { status: Number(status) })) })).rejects.toMatchObject({ code });
});
it("distinguishes a recorded refund", async () => {
  const history = await fetchBmcRenewalHistory("1146135", 1, { session, fetcher: vi.fn().mockResolvedValue(envelope([{ ...row, is_refunded: true } as unknown as typeof row])) });
  expect(history.payments[0]).toMatchObject({ state: "REFUNDED", refundStatus: "REFUNDED" });
});
it.each([
  { ...row, fk_subscription_id: 999 },
  { ...row, support_total_charged_amount: "not-money" },
  { ...row, support_created_on: "2026-11-25" },
  { ...row, transaction_id: null },
])("fails closed on malformed provider records", async record => {
  await expect(fetchBmcRenewalHistory("1146135", 1, { session, fetcher: vi.fn().mockResolvedValue(Response.json({ data: [record], meta: { current_page: 1, last_page: 1, total: 1 } })) })).rejects.toMatchObject({ code: "INVALID_PROVIDER_DATA" });
});
it("rejects inconsistent pagination and duplicate charge records", async () => {
  for (const response of [envelope([row, row]), envelope([row], { current_page: 2, last_page: 2, total: 1 })]) {
    await expect(fetchBmcRenewalHistory("1146135", 1, { session, fetcher: vi.fn().mockResolvedValue(response) })).rejects.toMatchObject({ code: "INVALID_PROVIDER_DATA" });
  }
});

it("retries temporary provider failures and returns only the complete successful page", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("upstream error", { status: 502 })).mockResolvedValueOnce(envelope());
  expect(await fetchBmcRenewalHistory("1146135", 1, { session, fetcher })).toMatchObject({ total: 1 });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("accepts valid dashboard JSON with a mislabeled content type", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ view: "" }), { headers: { "Content-Type": "text/html" } }));
  expect(await fetchBmcDashboardJson("https://studio.buymeacoffee.com/api/supporters/onetime?page=1", { session: { ...session, studioCookie: "private-studio" }, fetcher })).toEqual({ view: "" });
});
it("reports endpoint and HTTP status after bounded retries without leaking a provider body", async () => {
  const fetcher = vi.fn().mockImplementation(async () => new Response("secret-cookie=private", { status: 503 }));
  await expect(fetchBmcRenewalHistory("1146135", 1, { session, fetcher })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", message: expect.stringContaining("monthly history failed (HTTP 503)") });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("recognizes a successful HTTP response containing a sign-in form without retrying it", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('<form action="/login"><input type="password"></form>', { headers: { "Content-Type": "text/html" } }));
  await expect(fetchBmcRenewalHistory("1146135", 1, { session, fetcher })).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  expect(fetcher).toHaveBeenCalledOnce();
});
