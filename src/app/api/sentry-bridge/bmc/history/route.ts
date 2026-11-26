import { bridgeAuthorized } from "@/lib/donor-bridge";
import { bmcHistoryHealth, readBmcHistorySnapshot } from "@/lib/bmc-history-sync";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  if (!bridgeAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const page = Number(new URL(request.url).searchParams.get("page") || "1");
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) return Response.json({ error: "Invalid page" }, { status: 400, headers });
  try {
    const [snapshot, health] = await Promise.all([readBmcHistorySnapshot(), bmcHistoryHealth()]);
    if (!snapshot) return Response.json({ error: "A complete BMC history sync is required", health }, { status: 503, headers });
    const sorted = snapshot.payments.slice().sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
    const rows = sorted.slice((page - 1) * 100, page * 100).map(row => ({ ...row,
      reviewReasons: snapshot.reviews.filter(review => review.id === row.id).map(review => review.reason) }));
    return Response.json({ payments: rows, page, total: sorted.length, hasMore: page * 100 < sorted.length,
      fetchedAt: snapshot.fetchedAt, coverage: snapshot.coverage, stale: Boolean(health.errorCode) || Date.now() - Date.parse(snapshot.fetchedAt) > 30 * 60_000,
      health, subscriptions: snapshot.subscriptions, reviews: snapshot.reviews, source: "BMC_DASHBOARD", readOnly: true,
      warning: "History evidence is not an XP award instruction. Missing or unverified entries require review; never reverse an existing award solely because a record is absent." }, { headers });
  } catch { return Response.json({ error: "History unavailable" }, { status: 503, headers }); }
}
