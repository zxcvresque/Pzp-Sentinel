import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  finalizeCapturedDonation,
  finalizeMonthlySubscriptionCharge,
  RazorpayError,
  verifyWebhookSignature,
} from "@/lib/razorpay";

export const runtime = "nodejs";

type WebhookPayload = {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string } };
    order?: { entity?: { id?: string } };
    subscription?: { entity?: { id?: string; status?: string; paid_count?: number } };
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
    const subscription = body.payload?.subscription?.entity;

    if (event === "subscription.charged" && subscription?.id && paymentId) {
      await finalizeMonthlySubscriptionCharge({
        subscriptionId: subscription.id,
        paymentId,
        status: subscription.status,
        paidCount: subscription.paid_count,
      });
    } else if ((event === "payment.captured" || event === "order.paid") && orderId && paymentId) {
      // Subscription invoice payments also emit payment events, but their order
      // IDs are not Sentinel one-time orders. The subscription.charged event is
      // the authoritative path for those payments.
      const storedOrder = await prisma.razorpayOrder.findUnique({
        where: { razorpayOrderId: orderId },
        select: { id: true },
      });
      if (storedOrder) {
        await finalizeCapturedDonation({ orderId, paymentId, actorName: "Razorpay webhook" });
      }
    } else if (subscription?.id && event.startsWith("subscription.")) {
      await prisma.razorpaySubscription.updateMany({
        where: { razorpaySubscriptionId: subscription.id },
        data: {
          status: (subscription.status || event.split(".").at(-1) || "updated").toUpperCase(),
          ...(Number.isInteger(subscription.paid_count) ? { paidCount: subscription.paid_count } : {}),
        },
      });
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
