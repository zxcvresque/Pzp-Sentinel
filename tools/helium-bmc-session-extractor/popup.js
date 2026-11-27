// No background worker, remote code, storage, telemetry, or network requests.
const button = document.querySelector("#copy");
const status = document.querySelector("#status");
function cookieHeader(cookies) {
  const live = cookies.filter(cookie => !cookie.expirationDate || cookie.expirationDate > Date.now() / 1000);
  const names = new Set();
  for (const cookie of live) {
    if (names.has(cookie.name)) throw Error("BMC has overlapping cookies. Use Sentinel’s manual request-header import for this session.");
    names.add(cookie.name);
  }
  if (!live.some(cookie => cookie.httpOnly && cookie.value)) throw Error("No signed-in BMC session was found. Sign in to the creator dashboard and try again.");
  return live.map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
}
button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Reading the BMC session in this window…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let url;
    try { url = new URL(tab?.url || ""); } catch { throw Error("Open your BMC creator dashboard in the active tab first."); }
    if (url.protocol !== "https:" || !["buymeacoffee.com", "www.buymeacoffee.com", "studio.buymeacoffee.com", "app.buymeacoffee.com"].includes(url.hostname)) throw Error("Open your BMC creator dashboard in the active tab first.");
    const stores = await chrome.cookies.getAllCookieStores();
    const store = stores.find(item => item.tabIds.includes(tab.id));
    if (!store) throw Error("This window’s cookie store is unavailable. If using Incognito, enable this extension there first.");
    const [appCookies, studioCookies] = await Promise.all([
      chrome.cookies.getAll({ url: "https://app.buymeacoffee.com/api/v1/subscriptions", storeId: store.id }),
      chrome.cookies.getAll({ url: "https://studio.buymeacoffee.com/dashboard", storeId: store.id }),
    ]);
    const token = { format: "sentinel-bmc-session", version: 1, appCookie: cookieHeader(appCookies), studioCookie: cookieHeader(studioCookies) };
    await navigator.clipboard.writeText(JSON.stringify(token));
    status.textContent = "Copied. Paste into Sentinel → Transactions → BMC connection → Import Helium session.";
  } catch (error) {
    // Display only fixed guidance. Never log or render cookie values.
    status.textContent = error instanceof Error ? error.message : "The session could not be copied. Try the manual request-header import.";
  } finally { button.disabled = false; }
});
