import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("./bmc-private-store", () => ({ mutateBmcSession: mocks.mutate }));
import { importBmcSession, parseBmcSessionHeaders, parseBmcSessionToken } from "./bmc-session-import";
const rawApp = "Cookie: bmc_session=app-secret; XSRF-TOKEN=a%2Bb\nX-XSRF-TOKEN: a+b\nAccept: application/json";
const rawStudio = "cookie\nbmc_session=studio-secret\naccept\ntext/html";
const subscription = { id: 1, fk_user_id_payer: 9, psp_id: "sub_example", subscription_is_cancelled: null, subscription_is_cancelled_at_period_end: null, is_paused: 0, subscription_cancelled_on: null, renewal_on: "2026-12-16 00:16:27" };
const subscriptions = () => Response.json({ data: [subscription], meta: { current_page: 1 }, links: { next: null } });
function validFetcher() { return vi.fn().mockResolvedValueOnce(new Response('<html><a href="https://buymeacoffee.com/creator">View page</a></html>', { headers: { "Content-Type": "text/html" } })).mockResolvedValueOnce(subscriptions()).mockResolvedValueOnce(subscriptions()).mockResolvedValueOnce(Response.json({ view: "" })); }
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("BMC_ACCOUNT_SLUG", "creator"); });
it("accepts only the versioned extractor format without executing pasted content", () => {
  const token = JSON.stringify({ format: "sentinel-bmc-session", version: 1, appCookie: "session=app", studioCookie: "session=studio" });
  expect(parseBmcSessionToken(token)).toEqual({ app: { cookie: "session=app" }, studio: { cookie: "session=studio" } });
  for (const value of ["document.cookie", '{"format":"other"}', '{"format":"sentinel-bmc-session","version":2}']) expect(() => parseBmcSessionToken(value)).toThrow();
});
it("imports a copied extractor token through the same account validation", async () => {
  const token = JSON.stringify({ format: "sentinel-bmc-session", version: 1, appCookie: "session=app", studioCookie: "session=studio" });
  expect(await importBmcSession("admin", undefined, undefined, validFetcher(), token)).toMatchObject({ connected: true });
  expect(mocks.mutate).toHaveBeenCalledOnce();
});
it("accepts copied request headers, two-line DevTools fields and a raw cookie value", () => {
  expect(parseBmcSessionHeaders(rawApp)).toEqual({ cookie: "bmc_session=app-secret; XSRF-TOKEN=a%2Bb", xsrfToken: "a+b" });
  expect(parseBmcSessionHeaders(rawStudio)).toEqual({ cookie: "bmc_session=studio-secret" });
  expect(parseBmcSessionHeaders("bmc_session=secret; XSRF-TOKEN=a%2Bb")).toMatchObject({ xsrfToken: "a+b" });
});
it.each(["", "set-cookie: bmc_session=secret", 'fetch("https://evil.test")', "Cookie: a=one\nCookie: a=two", "Cookie: a=one; a=two", "Cookie: a=secret\rInjected: value", "Cookie: a=has space", "x".repeat(32769)])("rejects malformed input without printing it", input => {
  expect(() => parseBmcSessionHeaders(input)).toThrow(/Paste the Cookie value/);
});
it("validates creator ownership and both history origins before replacing the session", async () => {
  const fetcher = validFetcher();
  const result = await importBmcSession("admin", rawApp, rawStudio, fetcher);
  expect(result).toMatchObject({ connected: true, accountSlug: "creator" });
  expect(JSON.stringify(result)).not.toMatch(/app-secret|studio-secret/);
  expect(mocks.mutate).toHaveBeenCalledOnce();
  const saved = await mocks.mutate.mock.calls[0][0](null);
  expect(saved).toMatchObject({ connectedBy: "admin", accountSlug: "creator", cookie: "bmc_session=app-secret; XSRF-TOKEN=a%2Bb", studioCookie: "bmc_session=studio-secret" });
  expect(saved.generation).toMatch(/^[a-f0-9-]{36}$/);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "manual", method: "GET", headers: { Cookie: "bmc_session=studio-secret" } });
  expect(fetcher.mock.calls.every(([url]) => /^https:\/\/(studio|app)\.buymeacoffee\.com\//.test(url))).toBe(true);
});
it.each([302, 401, 419])("leaves the working session untouched when the imported session expired (%s)", async status => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }));
  await expect(importBmcSession("admin", rawApp, rawStudio, fetcher)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  expect(mocks.mutate).not.toHaveBeenCalled();
});
it("rejects a different creator, deceptive URLs or profile links inside script text", async () => {
  for (const html of ['<a href="https://buymeacoffee.com/other">View page</a>', '<a href="https://buymeacoffee.com.evil.test/creator">View page</a>', '<script>"https://buymeacoffee.com/creator"</script>']) {
    await expect(importBmcSession("admin", rawApp, rawStudio, vi.fn().mockResolvedValue(new Response(html, { headers: { "Content-Type": "text/html" } })))).rejects.toMatchObject({ code: "ACCOUNT_MISMATCH" });
  }
  expect(mocks.mutate).not.toHaveBeenCalled();
});
it("rejects mixed app and studio accounts without changing existing credentials", async () => {
  const fetcher = validFetcher();
  fetcher.mockReset().mockResolvedValueOnce(new Response('<a href="https://buymeacoffee.com/creator">View page</a>', { headers: { "Content-Type": "text/html" } })).mockResolvedValueOnce(subscriptions()).mockResolvedValueOnce(Response.json({ data: [{ ...subscription, id: 2 }], meta: { current_page: 1 }, links: { next: null } }));
  await expect(importBmcSession("admin", rawApp, rawStudio, fetcher)).rejects.toMatchObject({ code: "SESSION_IDENTITY_UNVERIFIED" });
  expect(mocks.mutate).not.toHaveBeenCalled();
});
it("validates one-time access before saving, preserving old credentials if that fails", async () => {
  const fetcher = validFetcher(); fetcher.mockReset().mockResolvedValueOnce(new Response('<a href="https://buymeacoffee.com/creator">View page</a>', { headers: { "Content-Type": "text/html" } })).mockResolvedValueOnce(subscriptions()).mockResolvedValueOnce(subscriptions()).mockResolvedValueOnce(new Response(null, { status: 403 }));
  await expect(importBmcSession("admin", rawApp, rawStudio, fetcher)).rejects.toMatchObject({ code: "PROVIDER_ACCESS_DENIED" });
  expect(mocks.mutate).not.toHaveBeenCalled();
});
