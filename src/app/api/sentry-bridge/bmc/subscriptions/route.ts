import { bridgeAuthorized } from "@/lib/donor-bridge";
import { fetchBmcSubscriptions } from "@/lib/bmc-account-history";
import { BmcHistoryError } from "@/lib/bmc-history";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  if (!bridgeAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const page = Number(new URL(request.url).searchParams.get("page") || "1");
  try { return Response.json(await fetchBmcSubscriptions(page), { headers }); }
  catch (error) { return Response.json(error instanceof BmcHistoryError ? { error: error.message, code: error.code } : { error: "History unavailable" }, { status: error instanceof BmcHistoryError ? error.status : 503, headers }); }
}
