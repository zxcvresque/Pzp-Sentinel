import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { bmcAccountSlug } from "./bmc-attribution";
import { BmcHistoryError, bmcDashboardSession } from "./bmc-history";
import { fetchBmcSubscriptions } from "./bmc-account-history";
import { mutateBmcSession } from "./bmc-private-store";

const WIDTH = 390;
const HEIGHT = 700;
const TTL = 15 * 60_000;
type Login = { browser: Browser; context: BrowserContext; page: Page; owner: string; id: string; expiresAt: number; timer: ReturnType<typeof setTimeout>; requests: number; window: number };
const globals = globalThis as typeof globalThis & { bmcLogin?: Login; bmcLoginQueue?: Promise<unknown> };
export type BmcBrowserAction =
  | { action: "start" | "finish" | "cancel" | "disconnect"; loginId?: string }
  | { action: "click"; loginId: string; x: number; y: number }
  | { action: "type"; loginId: string; text: string }
  | { action: "key"; loginId: string; key: string }
  | { action: "scroll"; loginId: string; dy: number };

export function allowedBmcNavigation(raw: string) {
  try { const url = new URL(raw); return url.protocol === "https:" && !url.port && !url.username && !url.password && ["buymeacoffee.com", "www.buymeacoffee.com", "app.buymeacoffee.com", "studio.buymeacoffee.com"].includes(url.hostname); } catch { return false; }
}
export function validateBmcBrowserAction(value: unknown): value is BmcBrowserAction {
  if (!value || typeof value !== "object" || !("action" in value)) return false;
  const v = value as Record<string, unknown>;
  if (["start", "disconnect"].includes(String(v.action))) return true;
  if (typeof v.loginId !== "string" || !/^[a-f0-9-]{36}$/.test(v.loginId)) return false;
  if (["finish", "cancel"].includes(String(v.action))) return true;
  if (v.action === "click") return typeof v.x === "number" && typeof v.y === "number" && Number.isFinite(v.x) && Number.isFinite(v.y) && v.x >= 0 && v.x < WIDTH && v.y >= 0 && v.y < HEIGHT;
  if (v.action === "type") return typeof v.text === "string" && v.text.length > 0 && v.text.length <= 1000;
  if (v.action === "key") return ["Enter", "Tab", "Shift+Tab", "Backspace", "Escape", "ControlOrMeta+A", "ArrowUp", "ArrowDown"].includes(String(v.key));
  return v.action === "scroll" && typeof v.dy === "number" && Number.isFinite(v.dy) && Math.abs(v.dy) <= 1000;
}
async function closeLogin() {
  const login = globals.bmcLogin;
  delete globals.bmcLogin;
  if (login) { clearTimeout(login.timer); await login.context.close().catch(() => undefined); await login.browser.close().catch(() => undefined); }
}
function ownedLogin(owner: string, id?: string) {
  const login = globals.bmcLogin;
  if (!login || login.owner !== owner || login.id !== id || login.expiresAt < Date.now()) throw new BmcHistoryError("LOGIN_EXPIRED", "This private login has ended. Start a new connection.", 409);
  if (Date.now() - login.window > 60_000) { login.window = Date.now(); login.requests = 0; }
  if (++login.requests > 120) throw new BmcHistoryError("LOGIN_BUSY", "Please wait a moment before trying again.", 429);
  return login;
}
export async function bmcConnectionStatus(owner: string) {
  let connected = false;
  let connectedAt: string | null = null;
  try {
    const session = await bmcDashboardSession();
    connected = session.accountSlug === bmcAccountSlug() && Boolean(session.studioCookie);
    connectedAt = session.connectedAt || null;
  } catch { /* Not connected yet. */ }
  const login = globals.bmcLogin;
  return { connected, connectedAt, accountSlug: bmcAccountSlug(), login: login?.owner === owner && login.expiresAt > Date.now() ? { id: login.id, expiresAt: new Date(login.expiresAt).toISOString(), width: WIDTH, height: HEIGHT } : null };
}
async function frame(login: Login) {
  if (!allowedBmcNavigation(login.page.url())) throw new BmcHistoryError("LOGIN_NAVIGATION_BLOCKED", "Use BMC’s email login in this private window. External sign-in windows are unavailable.", 409);
  return { loginId: login.id, width: WIDTH, height: HEIGHT, expiresAt: new Date(login.expiresAt).toISOString(), image: `data:image/jpeg;base64,${(await login.page.screenshot({ type: "jpeg", quality: 75, timeout: 10000 })).toString("base64")}`, host: new URL(login.page.url()).host };
}
async function perform(owner: string, input: BmcBrowserAction) {
  if (input.action === "disconnect") {
    if (globals.bmcLogin && globals.bmcLogin.owner !== owner) throw new BmcHistoryError("LOGIN_BUSY", "Another admin is connecting BMC. Try again when they finish.", 409);
    await closeLogin();
    await mutateBmcSession(() => null);
    return { disconnected: true };
  }
  if (input.action === "start") {
    if (bmcAccountSlug() === "current") throw new BmcHistoryError("ACCOUNT_NOT_CONFIGURED", "Set BMC_ACCOUNT_SLUG to your creator account before connecting.", 503);
    if (globals.bmcLogin && globals.bmcLogin.owner !== owner && globals.bmcLogin.expiresAt > Date.now()) throw new BmcHistoryError("LOGIN_BUSY", "Another admin is connecting BMC. Try again when they finish.", 409);
    await closeLogin();
    let browser: Browser;
    try { browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...(process.env.BMC_CHROMIUM_EXECUTABLE ? { executablePath: process.env.BMC_CHROMIUM_EXECUTABLE } : {}) }); }
    catch { throw new BmcHistoryError("BROWSER_UNAVAILABLE", "The private browser could not start. On the VPS, install Chromium with: npx playwright install --with-deps chromium. Run Sentinel as a non-root user with Chromium sandbox support.", 503); }
    try {
      // No storageState or persistent profile: every interactive login starts Incognito.
      const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, acceptDownloads: false, serviceWorkers: "block" });
      await context.route("**/*", async route => {
        const request = route.request();
        const url = new URL(request.url());
        const host = url.hostname;
        const allowedResource = allowedBmcNavigation(url.href) || host.endsWith(".buymeacoffee.com") || host === "challenges.cloudflare.com" || host.endsWith(".hcaptcha.com") || host === "hcaptcha.com" || host.endsWith(".gstatic.com") || host === "www.google.com" || host.endsWith(".googleapis.com");
        // The connection window is never a payment/refund/account-management tool.
        if (url.protocol !== "https:" || !allowedResource || /\/(refund|payout|cancel|delete|transfer|withdraw)/i.test(url.pathname) || (request.isNavigationRequest() && request.frame().parentFrame() === null && !allowedBmcNavigation(url.href))) await route.abort();
        else await route.continue();
      });
      const page = await context.newPage();
      page.on("popup", popup => { void popup.close(); });
      const expiresAt = Date.now() + TTL;
      const timer = setTimeout(() => { if (globals.bmcLogin?.context === context) void closeLogin(); }, TTL);
      timer.unref();
      globals.bmcLogin = { browser, context, page, owner, id: randomUUID(), expiresAt, timer, requests: 0, window: Date.now() };
      await page.goto("https://studio.buymeacoffee.com/dashboard", { waitUntil: "domcontentloaded", timeout: 45000 });
      return await frame(globals.bmcLogin);
    } catch (error) { await closeLogin(); await browser.close().catch(() => undefined); throw error; }
  }
  const login = ownedLogin(owner, input.loginId);
  if (input.action === "cancel") { await closeLogin(); return { cancelled: true }; }
  if (input.action === "finish") {
    await login.page.goto("https://studio.buymeacoffee.com/dashboard", { waitUntil: "domcontentloaded", timeout: 30000 });
    const slug = bmcAccountSlug();
    const accountMatches = await login.page.locator(`a[href="https://buymeacoffee.com/${slug}"],a[href="https://www.buymeacoffee.com/${slug}"],a[href="https://buymeacoffee.com/${slug}/"]`).count();
    if (!accountMatches || /\/login|\/signup|\/sign-in/.test(login.page.url())) throw new BmcHistoryError("LOGIN_INCOMPLETE", `Complete BMC login for ${slug}, then select “Connect account” again.`, 409);
    const appCookies = await login.context.cookies("https://app.buymeacoffee.com/");
    const studioCookies = await login.context.cookies("https://studio.buymeacoffee.com/");
    const cookie = appCookies.map(c => `${c.name}=${c.value}`).join("; ");
    const studioCookie = studioCookies.map(c => `${c.name}=${c.value}`).join("; ");
    let xsrfToken: string | undefined;
    const xsrf = appCookies.find(c => c.name === "XSRF-TOKEN");
    if (xsrf) xsrfToken = decodeURIComponent(xsrf.value);
    const session = { cookie, studioCookie, xsrfToken, connectedAt: new Date().toISOString(), connectedBy: owner, accountSlug: slug, generation: randomUUID() };
    await fetchBmcSubscriptions(1, { session });
    await mutateBmcSession(() => session);
    await closeLogin();
    return { connected: true };
  }
  if (!allowedBmcNavigation(login.page.url())) throw new BmcHistoryError("LOGIN_NAVIGATION_BLOCKED", "Restart the BMC email login.", 409);
  if (input.action === "click") await login.page.mouse.click(input.x, input.y);
  if (input.action === "type") await login.page.keyboard.insertText(input.text);
  if (input.action === "key") await login.page.keyboard.press(input.key);
  if (input.action === "scroll") await login.page.mouse.wheel(0, input.dy);
  return frame(login);
}
export async function controlBmcBrowser(owner: string, action: BmcBrowserAction) {
  const next = (globals.bmcLoginQueue || Promise.resolve()).catch(() => undefined).then(() => perform(owner, action));
  globals.bmcLoginQueue = next;
  return next;
}
export async function bmcBrowserFrame(owner: string, id: string) {
  const next = (globals.bmcLoginQueue || Promise.resolve()).catch(() => undefined).then(() => frame(ownedLogin(owner, id)));
  globals.bmcLoginQueue = next;
  return next;
}
