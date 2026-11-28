import { bridgeAuthorized } from "@/lib/donor-bridge";
import { BmcUnverifiedError, getDonation } from "@/lib/donor-bridge-donations";

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
  } catch (error) {
    // Unverified is not "not found": a 404 could be mistaken for a removed payment.
    if (error instanceof BmcUnverifiedError) return Response.json({ error: error.message, code: error.code }, { status: 503, headers });
    return Response.json({ error: "Donation lookup unavailable" }, { status: 503, headers });
  }
}
