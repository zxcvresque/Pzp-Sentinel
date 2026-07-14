import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  finalizeCapturedDonation,
  RazorpayError,
  verifyWebhookSignature,
} from "@/lib/razorpay";

export const runtime = "nodejs";

type WebhookPayload = {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string } };
    order?: { entity?: { id?: string } };
  };
};

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") || "";
  const eventId = request.headers.get("x-razorpay-event-id") || "";

  try {
    if (!signature || !verifyWebhookSignature(rawBody, signature)) {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }
    if (eventId) {
      const duplicate = await prisma.razorpayWebhookEvent.findUnique({ where: { eventId } });
      if (duplicate) return NextResponse.json({ ok: true, duplicate: true });
    }

    const body = JSON.parse(rawBody) as WebhookPayload;
    const event = body.event || "unknown";
    const paymentId = body.payload?.payment?.entity?.id;
    const orderId = body.payload?.order?.entity?.id || body.payload?.payment?.entity?.order_id;

    if ((event === "payment.captured" || event === "order.paid") && orderId && paymentId) {
      await finalizeCapturedDonation({ orderId, paymentId, actorName: "Razorpay webhook" });
    }

    if (eventId) {
      await prisma.razorpayWebhookEvent.create({
        data: { eventId, eventType: event },
      }).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = error instanceof RazorpayError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Webhook processing failed";
    console.error("[razorpay] webhook failed:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
