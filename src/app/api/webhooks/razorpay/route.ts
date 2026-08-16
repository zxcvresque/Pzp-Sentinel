import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  finalizeCapturedDonation,
  finalizeMonthlyPaymentByReference,
  finalizeMonthlySubscriptionCharge,
  handleRazorpaySubscriptionLifecycle,
  RazorpayError,
  verifyWebhookSignature,
} from "@/lib/razorpay";
import {
  normalizeRazorpaySubscriptionEvent,
  shouldFinalizeSubscriptionPayment,
  type RazorpaySubscriptionWebhookEntity,
} from "@/lib/razorpay-subscription-events";
import { encryptSecret } from "@/lib/secret-crypto";
import { Prisma } from "@/generated/prisma/client";

export const runtime = "nodejs";

type WebhookPayload = {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; invoice_id?: string | null } };
    order?: { entity?: { id?: string } };
    subscription?: { entity?: RazorpaySubscriptionWebhookEntity };
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
      if (duplicate?.status === "PROCESSED") return NextResponse.json({ ok: true, duplicate: true });
    }

    const body = JSON.parse(rawBody) as WebhookPayload;
    const event = body.event || "unknown";
    const paymentId = body.payload?.payment?.entity?.id;
    const invoiceId = body.payload?.payment?.entity?.invoice_id;
    const orderId = body.payload?.order?.entity?.id || body.payload?.payment?.entity?.order_id;
    const subscription = body.payload?.subscription?.entity;
    const subscriptionEvent = normalizeRazorpaySubscriptionEvent(event, subscription);
    let processingStatus = "PROCESSED";
    const resourceId = paymentId || subscriptionEvent?.subscriptionId || orderId || null;
    if (eventId) {
      await prisma.razorpayWebhookEvent.upsert({
        where: { eventId },
        update: {
          eventType: event,
          resourceId,
          payload: Prisma.JsonNull,
          encryptedPayload: encryptSecret(rawBody),
          status: "RECEIVED",
        },
        create: {
          eventId,
          eventType: event,
          resourceId,
          payload: Prisma.JsonNull,
          encryptedPayload: encryptSecret(rawBody),
          status: "RECEIVED",
        },
      });
    }

    if (subscriptionEvent && shouldFinalizeSubscriptionPayment(subscriptionEvent, paymentId)) {
      await finalizeMonthlySubscriptionCharge({
        subscriptionId: subscriptionEvent.subscriptionId,
        paymentId: paymentId!,
        status: subscriptionEvent.status,
        paidCount: subscriptionEvent.paidCount,
      });
      if (event !== "subscription.charged") {
        await handleRazorpaySubscriptionLifecycle(subscriptionEvent);
      }
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
      } else {
        const recovered = await finalizeMonthlyPaymentByReference({ paymentId, invoiceId });
        if (!recovered.matched) processingStatus = "UNMATCHED";
      }
    } else if (subscriptionEvent) {
      await handleRazorpaySubscriptionLifecycle(subscriptionEvent);
    }

    if (eventId) await prisma.razorpayWebhookEvent.update({ where: { eventId }, data: { status: processingStatus } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = error instanceof RazorpayError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Webhook processing failed";
    console.error("[razorpay] webhook failed:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
