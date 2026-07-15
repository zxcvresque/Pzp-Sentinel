import { NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";

const CREATION_EVENTS = [
  "donation.created",
  "extra_purchase.created",
  "commission_order.created",
  "wishlist_payment.created",
  "membership.started",
  "recurring_donation.started",
];

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user.roles, "ADMIN")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const [transactions, events] = await Promise.all([
      prisma.transaction.findMany({
        where: { method: "BMC", status: "APPROVED", isTest: false },
        orderBy: { date: "desc" },
        select: { id: true, amount: true, currency: true, description: true, date: true, bmcEventId: true },
      }),
      prisma.bmcWebhookEvent.findMany({
        where: { processedAt: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          eventType: true,
          liveMode: true,
          supporterName: true,
          amount: true,
          currency: true,
          status: true,
          transactionId: true,
          createdAt: true,
        },
      }),
    ]);

    const totalsByCurrency = transactions.reduce<Record<string, number>>((totals, transaction) => {
      totals[transaction.currency] = (totals[transaction.currency] || 0) + Number(transaction.amount);
      return totals;
    }, {});
    const webhookSupporters = events
      .filter((event) => event.liveMode && CREATION_EVENTS.includes(event.eventType) && event.supporterName)
      .map((event) => event.supporterName as string);
    const fallbackSupporters = transactions.map((transaction) => {
      const match = transaction.description.match(/^BMC[^:]*:\s+([^·—]+?)(?:\s+x\d|\s+·|\s+—|$)/);
      return match?.[1]?.trim() || null;
    }).filter((name): name is string => Boolean(name));
    const eventBreakdown = events.reduce<Record<string, number>>((counts, event) => {
      const category = event.eventType.split(".")[0];
      counts[category] = (counts[category] || 0) + 1;
      return counts;
    }, {});

    return NextResponse.json({
      webhookConfigured: Boolean(process.env.BMC_WEBHOOK_SECRET?.trim()),
      legacySyncAvailable: Boolean(process.env.BMC_TOKEN?.trim()),
      checkoutUrl: process.env.BMC_PAGE_URL?.trim() || null,
      totalSupporters: new Set(webhookSupporters.length ? webhookSupporters : fallbackSupporters).size,
      totalEarned: Math.round((totalsByCurrency.USD || 0) * 100) / 100,
      totalsByCurrency,
      totalTransactions: transactions.length,
      eventBreakdown,
      recent: transactions.slice(0, 10).map((transaction) => ({
        ...transaction,
        amount: transaction.amount.toString(),
        date: transaction.date.toISOString(),
      })),
      recentEvents: events.slice(0, 10).map((event) => ({
        ...event,
        amount: event.amount?.toString() || null,
        createdAt: event.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("[bmc] stats failed:", error);
    return NextResponse.json({ error: "Failed to fetch BMC stats" }, { status: 500 });
  }
}
