import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { bmcBrowserFrame, bmcConnectionStatus, controlBmcBrowser, validateBmcBrowserAction } from "@/lib/bmc-browser-connection";
import { bmcHistoryHealth, readBmcHistorySnapshot, syncBmcAccountHistory } from "@/lib/bmc-history-sync";
import { BmcHistoryError } from "@/lib/bmc-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
async function admin() {
  const user = await getCurrentUser();
  return user?.roles.includes("ADMIN") ? user : null;
}
function fail(error: unknown) {
  return error instanceof BmcHistoryError ? json({ error: error.message, code: error.code }, error.status) : json({ error: "BMC connection could not complete. Retry or restart the private login.", code: "CONNECTION_FAILED" }, 503);
}
export async function GET(request: Request) {
  const user = await admin();
  if (!user) return json({ error: "Admin access required" }, 403);
  try {
    const loginId = new URL(request.url).searchParams.get("loginId");
    if (loginId) return json(await bmcBrowserFrame(user.id, loginId));
    const [connection, health, snapshot] = await Promise.all([bmcConnectionStatus(user.id), bmcHistoryHealth(), readBmcHistorySnapshot()]);
    return json({ ...connection, health, subscriptions: snapshot?.subscriptions || [], reviews: snapshot?.reviews || [], payments: (snapshot?.payments || []).slice().sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 30) });
  } catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  const user = await admin();
  if (!user) return json({ error: "Admin access required" }, 403);
  const origin = request.headers.get("origin");
  const expected = new URL(process.env.WEBAPP_URL || request.url).origin;
  if (origin !== expected || request.headers.get("sec-fetch-site") === "cross-site") return json({ error: "Open this action from Sentinel." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "JSON required" }, 400);
  try {
    if (Number(request.headers.get("content-length") || 0) > 8000) return json({ error: "Request too large" }, 413);
    const text = await request.text();
    if (text.length > 8000) return json({ error: "Request too large" }, 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { return json({ error: "Invalid request" }, 400); }
    if (body && typeof body === "object" && "action" in body && body.action === "sync") {
      const connection = await bmcConnectionStatus(user.id);
      if (!connection.connected) return json({ error: "Connect your BMC account first." }, 409);
      after(async () => { await syncBmcAccountHistory(); });
      return json({ queued: true }, 202);
    }
    if (!validateBmcBrowserAction(body)) return json({ error: "Invalid browser action" }, 400);
    const result = await controlBmcBrowser(user.id, body);
    if (body.action === "finish") after(async () => { await syncBmcAccountHistory(); });
    return json(result);
  } catch (error) { return fail(error); }
}
