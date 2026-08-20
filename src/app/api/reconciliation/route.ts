import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { finalizeCapturedDonation, reconcileRecentRazorpaySubscriptionPayments } from "@/lib/razorpay";
import { logAudit } from "@/lib/audit";
import { decryptSecret } from "@/lib/secret-crypto";
import { parseBmcWebhook } from "@/lib/bmc-webhook";

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!hasRole(user.roles, "ADMIN")) return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

export async function GET() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const [unmatchedBmc, unmatchedRazorpayOrders, pendingRazorpayEvents, transactions] = await Promise.all([
    prisma.transaction.findMany({
      where: { method: "BMC", fromUserId: null, isTest: false, voidedAt: null },
      orderBy: { date: "desc" },
      include: {
        bmcWebhookEvents: {
          select: {
            supporterName: true,
            supporterEmail: true,
            supporterId: true,
            attributionStatus: true,
            encryptedPayload: true,
          },
        },
      },
    }),
    prisma.razorpayOrder.findMany({
      where: { status: "PAID", transactionId: null },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.razorpayWebhookEvent.findMany({
      where: { status: { not: "PROCESSED" } },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, eventId: true, eventType: true, resourceId: true, status: true, createdAt: true },
    }),
    prisma.transaction.findMany({
      where: { createdAt: { gte: since }, status: "APPROVED", isTest: false, voidedAt: null },
      orderBy: { date: "asc" },
      select: { id: true, amount: true, currency: true, method: true, date: true, description: true, fromUserId: true, providerPaymentId: true, bmcEventId: true },
    }),
  ]);

  const possibleDuplicates: Array<{ transactions: typeof transactions; reason: string }> = [];
  const used = new Set<string>();
  for (let index = 0; index < transactions.length; index += 1) {
    const base = transactions[index];
    if (used.has(base.id)) continue;
    const matches = transactions.slice(index + 1).filter((candidate) => (
      Number(candidate.amount) === Number(base.amount)
      && candidate.currency === base.currency
      && candidate.method === base.method
      && candidate.fromUserId === base.fromUserId
      && Math.abs(candidate.date.getTime() - base.date.getTime()) <= 10 * 60 * 1000
      && (!base.providerPaymentId || candidate.providerPaymentId !== base.providerPaymentId)
      && (!base.bmcEventId || candidate.bmcEventId !== base.bmcEventId)
    ));
    if (matches.length) {
      const group = [base, ...matches];
      group.forEach((transaction) => used.add(transaction.id));
      possibleDuplicates.push({ transactions: group, reason: "Same payer, amount, provider and currency within 10 minutes" });
    }
  }

  const safeUnmatchedBmc = unmatchedBmc.map((transaction) => ({
    ...transaction,
    providerDetailsEncrypted: undefined,
    bmcWebhookEvents: transaction.bmcWebhookEvents.map(({ encryptedPayload, ...event }) => {
      if (!encryptedPayload) return event;
      try {
        const normalized = parseBmcWebhook(decryptSecret(encryptedPayload));
        return { ...event, supporterName: normalized.supporterName, supporterEmail: normalized.supporterEmail };
      } catch {
        return event;
      }
    }),
  }));

  return NextResponse.json({ unmatchedBmc: safeUnmatchedBmc, unmatchedRazorpayOrders, pendingRazorpayEvents, possibleDuplicates });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const body = await req.json().catch(() => null);
  if (body?.action === "SYNC_RAZORPAY") {
    const result = await reconcileRecentRazorpaySubscriptionPayments(35);
    await logAudit({ userId: auth.user.id, userName: auth.user.name, action: "RAZORPAY_SYNC_NOW", entityType: "Razorpay", entityId: "subscriptions", after: result, request: req, outcome: result.errors.length ? "FAILURE" : "SUCCESS", errorMessage: result.errors.length ? result.errors.slice(0, 5).join("; ") : undefined });
    return NextResponse.json(result);
  }
  if (body?.action !== "CAPTURE_RAZORPAY_ORDER" || typeof body?.orderId !== "string") {
    return NextResponse.json({ error: "Invalid reconciliation action" }, { status: 400 });
  }
  const order = await prisma.razorpayOrder.findUnique({ where: { id: body.orderId } });
  if (!order || order.status !== "PAID" || !order.paymentId || order.transactionId) {
    return NextResponse.json({ error: "Razorpay order is not eligible for reconciliation" }, { status: 409 });
  }
  const result = await finalizeCapturedDonation({
    orderId: order.razorpayOrderId,
    paymentId: order.paymentId,
    actorName: auth.user.name,
  });
  await logAudit({
    userId: auth.user.id,
    action: "RAZORPAY_RECONCILED",
    entityType: "RazorpayOrder",
    entityId: order.id,
    transactionId: result.transaction.id,
    userName: auth.user.name,
    details: `Reconciled ${order.razorpayOrderId}`,
    request: req,
  });
  return NextResponse.json(result);
}
