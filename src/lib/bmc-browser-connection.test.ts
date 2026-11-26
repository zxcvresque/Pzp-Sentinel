import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => {
  const page = { goto: vi.fn(), on: vi.fn(), url: vi.fn(() => "https://studio.buymeacoffee.com/login"), screenshot: vi.fn(async () => Buffer.from("frame")), locator: vi.fn(() => ({ count: vi.fn(async () => 0) })), keyboard: { insertText: vi.fn(), press: vi.fn() }, mouse: { click: vi.fn(), wheel: vi.fn() } };
  const context = { route: vi.fn(), newPage: vi.fn(async () => page), close: vi.fn(), cookies: vi.fn() };
  const browser = { newContext: vi.fn(async () => context), close: vi.fn() };
  return { page, context, browser, launch: vi.fn(async () => browser), write: vi.fn() };
});
vi.mock("playwright", () => ({ chromium: { launch: mocks.launch } }));
vi.mock("./bmc-private-store", () => ({ mutateBmcSession: mocks.write }));
import { allowedBmcNavigation, bmcBrowserFrame, controlBmcBrowser, validateBmcBrowserAction } from "./bmc-browser-connection";
let loginId: string | undefined;
afterEach(async () => { if (loginId) await controlBmcBrowser("owner", { action: "cancel", loginId }).catch(() => undefined); loginId = undefined; vi.clearAllMocks(); });
it.each(["http://studio.buymeacoffee.com", "https://studio.buymeacoffee.com.evil.test", "https://user:pass@studio.buymeacoffee.com", "https://studio.buymeacoffee.com:8443", "file:///etc/passwd", "javascript:alert(1)"])("blocks non-BMC top-level navigation: %s", url => expect(allowedBmcNavigation(url)).toBe(false));
it("rejects arbitrary scripts, keys, out of range clicks and oversized field input", () => {
  const id = "e0b4fbcf-e685-4374-b340-793543c883a4";
  for (const input of [{ action: "evaluate", script: "1" }, { action: "key", key: "F12", loginId: id }, { action: "click", x: 400, y: 0, loginId: id }, { action: "type", text: "x".repeat(1001), loginId: id }, { action: "scroll", dy: Infinity, loginId: id }]) expect(validateBmcBrowserAction(input)).toBe(false);
  expect(validateBmcBrowserAction({ action: "type", text: "email@example.test", loginId: id })).toBe(true);
});
it("creates a fresh isolated context without persistent browser state and binds it to its owner", async () => {
  vi.stubEnv("BMC_ACCOUNT_SLUG", "creator");
  const frame = await controlBmcBrowser("owner", { action: "start" });
  loginId = (frame as { loginId: string }).loginId;
  expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({ chromiumSandbox: true }));
  expect(mocks.browser.newContext).toHaveBeenCalledWith({ viewport: { width: 390, height: 700 }, acceptDownloads: false, serviceWorkers: "block" });
  await expect(bmcBrowserFrame("another-admin", loginId!)).rejects.toMatchObject({ code: "LOGIN_EXPIRED" });
  await expect(controlBmcBrowser("another-admin", { action: "start" })).rejects.toMatchObject({ code: "LOGIN_BUSY" });
  await expect(controlBmcBrowser("owner", { action: "finish", loginId })).rejects.toMatchObject({ code: "LOGIN_INCOMPLETE" });
  expect(mocks.write).not.toHaveBeenCalled();
});
