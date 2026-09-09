import { bridgeAuthorized } from "@/lib/donor-bridge";
import { DonationQueryError, listDonations, parseDonationQuery } from "@/lib/donor-bridge-donations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  if (!bridgeAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const query = parseDonationQuery(new URL(request.url).searchParams);
    return Response.json(await listDonations(query), { headers });
  } catch (error) {
    if (error instanceof DonationQueryError) {
      return Response.json({ error: error.message }, { status: 400, headers });
    }
    return Response.json({ error: "Donation lookup unavailable" }, { status: 503, headers });
  }
}
