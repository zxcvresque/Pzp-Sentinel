import { bridgeAuthorized, bridgePool, refreshBridgeEvents, BRIDGE_START } from "@/lib/donor-bridge";

export const runtime = "nodejs";
export async function GET(request: Request) {
  if (!bridgeAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const cursor = new URL(request.url).searchParams.get("after") || "0";
  if (!/^\d{1,18}$/.test(cursor)) return Response.json({ error: "Invalid cursor" }, { status: 400 });
  try {
    await refreshBridgeEvents();
    const events = await bridgePool.query("SELECT seq::text AS seq,payload FROM donor_bridge_events WHERE seq>$1 ORDER BY seq LIMIT 100", [cursor]);
    const state = await bridgePool.query("SELECT key,value FROM donor_bridge_state");
    return Response.json({ events: events.rows, cutoff: BRIDGE_START, health: Object.fromEntries(state.rows.map(r => [r.key, r.value])) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Bridge unavailable; check migration and server logs" }, { status: 503 });
  }
}
