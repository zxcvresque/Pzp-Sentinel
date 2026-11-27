import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
const root = resolve("tools/helium-bmc-session-extractor");
const script = readFileSync(resolve(root, "popup.js"), "utf8");
function harness(url = "https://studio.buymeacoffee.com/dashboard", duplicate = false) {
  let click: () => Promise<void> = async () => {};
  const status = { textContent: "" };
  const button = { disabled: false, addEventListener: (_event: string, handler: () => Promise<void>) => { click = handler; } };
  const cookies = [{ name: "session", value: "private-cookie", httpOnly: true, expirationDate: Date.now() / 1000 + 1000 }];
  if (duplicate) cookies.push({ ...cookies[0] });
  const getAll = vi.fn(async () => cookies);
  const clipboard = vi.fn(async (text: string) => { void text; });
  runInNewContext(script, { document: { querySelector: (selector: string) => selector === "#copy" ? button : status },
    chrome: { tabs: { query: async () => [{ id: 42, url }] }, cookies: { getAllCookieStores: async () => [{ id: "normal", tabIds: [1] }, { id: "incognito", tabIds: [42] }], getAll } },
    navigator: { clipboard: { writeText: clipboard } }, URL, Date, Set, Error, JSON });
  return { click: () => click(), getAll, clipboard, status, button };
}
it("reads only on explicit click and copies both origin sessions from the active tab's store", async () => {
  const h = harness(); expect(h.getAll).not.toHaveBeenCalled();
  await h.click();
  expect(h.getAll).toHaveBeenCalledTimes(2);
  expect(h.getAll).toHaveBeenCalledWith({ url: "https://app.buymeacoffee.com/api/v1/subscriptions", storeId: "incognito" });
  expect(h.getAll).toHaveBeenCalledWith({ url: "https://studio.buymeacoffee.com/dashboard", storeId: "incognito" });
  const token = JSON.parse(h.clipboard.mock.calls[0][0] as unknown as string);
  expect(token).toMatchObject({ format: "sentinel-bmc-session", version: 1, appCookie: "session=private-cookie", studioCookie: "session=private-cookie" });
  expect(h.status.textContent).not.toContain("private-cookie"); expect(h.button.disabled).toBe(false);
});
it.each(["https://buymeacoffee.com.evil.test/dashboard", "https://evil.test", "http://studio.buymeacoffee.com/dashboard"])("does not extract when the active tab isn't the expected BMC HTTPS origin: %s", async url => {
  const h = harness(url); await h.click(); expect(h.getAll).not.toHaveBeenCalled(); expect(h.clipboard).not.toHaveBeenCalled();
});
it("does not silently combine ambiguous duplicate-name cookies", async () => {
  const h = harness(undefined, true); await h.click(); expect(h.clipboard).not.toHaveBeenCalled(); expect(h.status.textContent).toContain("overlapping cookies");
});
it("has only the cookie/clipboard permissions needed, no background worker, remote scripts or network calls", () => {
  const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
  expect(manifest.permissions).toEqual(["cookies", "clipboardWrite"]);
  expect(manifest.host_permissions).toEqual(["https://buymeacoffee.com/*", "https://*.buymeacoffee.com/*"]);
  expect(manifest).not.toHaveProperty("background");
  expect(script).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|chrome\.storage|console\.log/);
});
