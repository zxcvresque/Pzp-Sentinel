import { after } from "next/server";
import { bridgeAuthorized } from "@/lib/donor-bridge";
import { drainSentryWebhooks, queueWebhookTest, webhookConfig, webhookStatus } from "@/lib/sentry-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  if (!bridgeAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const eventId = new URL(request.url).searchParams.get("eventId") || undefined;
  if (eventId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
    return Response.json({ error: "Invalid event ID" }, { status: 400, headers });
  }
  try { return Response.json(await webhookStatus(eventId), { headers }); }
  catch { return Response.json({ error: "Webhook setup or queue unavailable" }, { status: 503, headers }); }
}

export async function POST(request: Request) {
  if (!bridgeAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400, headers }); }
  if (!body || body.action !== "test" || (body.telegramId != null && (typeof body.telegramId !== "string" || !/^\d{5,20}$/.test(body.telegramId)))) {
    return Response.json({ error: 'Use action="test" and an optional Telegram ID string' }, { status: 400, headers });
  }
  try {
    if (!webhookConfig()) return Response.json({ error: "Set SENTRY_WEBHOOK_URL to Sentry's HTTPS receiver first" }, { status: 503, headers });
    const eventId = await queueWebhookTest(body.telegramId || null);
    after(() => drainSentryWebhooks());
    return Response.json({ queued: true, eventId, type: "webhook.test", paymentCreated: false }, { status: 202, headers });
  } catch { return Response.json({ error: "Webhook setup or queue unavailable" }, { status: 503, headers }); }
}
