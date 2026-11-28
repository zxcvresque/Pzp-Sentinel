import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { bmcConnectionStatus, importBmcSession, disconnectBmcSession } from "@/lib/bmc-session-import";
import { bmcHistoryHealth, readBmcHistorySnapshot, syncBmcAccountHistory } from "@/lib/bmc-history-sync";
import { BmcHistoryError } from "@/lib/bmc-history";
import { bmcDonorVerificationList } from "@/lib/bmc-donor-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
async function admin() {
  const user = await getCurrentUser();
  return user?.roles.includes("ADMIN") ? user : null;
}
function fail(error: unknown) {
  return error instanceof BmcHistoryError ? json({ error: error.message, code: error.code }, error.status) : json({ error: "The BMC session could not be updated. Try again. Your existing session has not been replaced.", code: "SESSION_IMPORT_FAILED" }, 503);
}
export async function GET(request: Request) {
  const user = await admin();
  if (!user) return json({ error: "Admin access required" }, 403);
  if (new URL(request.url).searchParams.has("loginId")) return json({ error: "Browser login has been removed. Import your Helium session instead." }, 410);
  try {
    const [connection, health, snapshot, donors] = await Promise.all([bmcConnectionStatus(), bmcHistoryHealth(), readBmcHistorySnapshot(), bmcDonorVerificationList()]);
    return json({ ...connection, health, donors, subscriptions: snapshot?.subscriptions || [], reviews: snapshot?.reviews || [], payments: (snapshot?.payments || []).slice().sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 30) });
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
    if (Number(request.headers.get("content-length") || 0) > 100000) return json({ error: "Request too large" }, 413);
    const text = await request.text();
    if (text.length > 100000) return json({ error: "Request too large" }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: "Invalid request" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request" }, 400);
    if (body.action === "sync") {
      const connection = await bmcConnectionStatus();
      if (!connection.connected) return json({ error: "Import your BMC session first." }, 409);
      after(async () => { await syncBmcAccountHistory(); });
      return json({ queued: true }, 202);
    }
    if (body.action === "disconnect") { await disconnectBmcSession(); return json({ disconnected: true }); }
    if (body.action !== "import") return json({ error: "Invalid action. Import your Helium session instead of starting a browser." }, 400);
    const result = await importBmcSession(user.id, body.appHeaders, body.studioHeaders, undefined, body.sessionToken);
    after(async () => { await syncBmcAccountHistory(); });
    return json(result);
  } catch (error) { return fail(error); }
}
