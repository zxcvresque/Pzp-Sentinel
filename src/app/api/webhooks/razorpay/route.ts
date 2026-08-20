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
    refund?: { entity?: { id?: string; payment_id?: string; amount?: number; currency?: string; created_at?: number } };
    subscription?: { entity?: RazorpaySubscriptionWebhookEntity };
  };
};

async function recordRazorpayRefund(refund: { id?: string; payment_id?: string; amount?: number; created_at?: number }) {
  if (!refund.id || !refund.payment_id || !Number.isFinite(refund.amount) || Number(refund.amount) <= 0) return false;
  const original = await prisma.transaction.findFirst({
    where: {
      OR: [
        { providerPaymentId: refund.payment_id },
        { razorpayOrder: { paymentId: refund.payment_id } },
      ],
    },
  });
  if (!original) return false;
  const amount = new Prisma.Decimal(Number(refund.amount) / 100);
  await prisma.$transaction(async (db) => {
    const existing = await db.transaction.findUnique({ where: { providerPaymentId: refund.id } });
    if (existing) return;
    await db.transaction.update({
      where: { id: original.id },
      data: { providerState: Number(amount) >= Number(original.amount) ? "REFUNDED" : "PARTIALLY_REFUNDED" },
    });
    await db.transaction.create({
      data: {
        amount,
        currency: original.currency,
        method: "RAZORPAY",
        direction: "OUT",
        type: "OTHER",
        donationFrequency: original.donationFrequency,
        providerPaymentId: refund.id,
        fromUserId: original.fromUserId,
        description: `Razorpay refund reversal: ${original.description}`,
        date: refund.created_at ? new Date(refund.created_at * 1000) : new Date(),
        status: "APPROVED",
        isTest: original.isTest,
        createdById: original.createdById,
        providerVerified: true,
        providerState: "REFUND_REVERSAL",
        reversalOfId: original.id,
      },
    });
  });
  return true;
}

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
    const refund = body.payload?.refund?.entity;
    const subscriptionEvent = normalizeRazorpaySubscriptionEvent(event, subscription);
    let processingStatus = "PROCESSED";
    const resourceId = refund?.id || paymentId || subscriptionEvent?.subscriptionId || orderId || null;
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

    if ((event === "refund.processed" || event === "payment.refunded") && refund) {
      const matched = await recordRazorpayRefund(refund);
      if (!matched) processingStatus = "UNMATCHED";
    } else if (subscriptionEvent && shouldFinalizeSubscriptionPayment(subscriptionEvent, paymentId)) {
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
