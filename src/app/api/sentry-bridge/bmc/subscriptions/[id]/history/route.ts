import { bridgeAuthorized } from "@/lib/donor-bridge";
import { BmcHistoryError, fetchBmcRenewalHistory } from "@/lib/bmc-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!bridgeAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const { id } = await params;
  const rawPage = new URL(request.url).searchParams.get("page") || "1";
  if (!/^\d{1,5}$/.test(rawPage)) return Response.json({ error: "Invalid page" }, { status: 400, headers });
  try {
    return Response.json(await fetchBmcRenewalHistory(id, Number(rawPage)), { headers });
  } catch (error) {
    if (error instanceof BmcHistoryError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers });
    return Response.json({ error: "History lookup unavailable" }, { status: 503, headers });
  }
}
