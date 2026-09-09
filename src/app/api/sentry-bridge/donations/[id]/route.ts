import { bridgeAuthorized } from "@/lib/donor-bridge";
import { getDonation } from "@/lib/donor-bridge-donations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!bridgeAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const { id } = await params;
    const donation = await getDonation(id);
    if (!donation) return Response.json({ error: "Donation not found or no longer eligible" }, { status: 404, headers });
    return Response.json({ donation }, { headers });
  } catch {
    return Response.json({ error: "Donation lookup unavailable" }, { status: 503, headers });
  }
}
