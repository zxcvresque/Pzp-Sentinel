import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const approved = await prisma.transaction.findMany({
    where: { status: "APPROVED" },
    select: { amount: true, direction: true, type: true, date: true },
  });

  const totalDonated = approved
    .filter((t: { direction: string }) => t.direction === "IN")
    .reduce((sum: number, t: { amount: unknown }) => sum + Number(t.amount), 0);

  const totalSpent = approved
    .filter((t: { direction: string }) => t.direction === "OUT")
    .reduce((sum: number, t: { amount: unknown }) => sum + Number(t.amount), 0);

  const pendingCount = await prisma.transaction.count({
    where: { status: "PENDING" },
  });

  // Monthly breakdown for the last 6 months
  const now = new Date();
  const monthlyBreakdown: { month: string; donated: number; spent: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleString("en-US", { month: "short", year: "2-digit" });
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);

    const monthTxns = approved.filter((t: { date: Date }) => {
      const td = new Date(t.date);
      return td >= start && td < end;
    });

    const donated = monthTxns
      .filter((t: { direction: string }) => t.direction === "IN")
      .reduce((s: number, t: { amount: unknown }) => s + Number(t.amount), 0);
    const spent = monthTxns
      .filter((t: { direction: string }) => t.direction === "OUT")
      .reduce((s: number, t: { amount: unknown }) => s + Number(t.amount), 0);

    monthlyBreakdown.push({ month: label, donated, spent });
  }

  // Expense breakdown by type (OUT direction only)
  const outgoing = approved.filter(
    (t: { direction: string }) => t.direction === "OUT",
  );
  const expenseByType: Record<string, number> = {};
  for (const t of outgoing) {
    const typ = (t as { type: string }).type || "OTHER";
    expenseByType[typ] = (expenseByType[typ] || 0) + Number(t.amount);
  }

  // Burn rate: average monthly OUT spending over last 6 months
  const monthsWithSpending = monthlyBreakdown.filter((m) => m.spent > 0);
  const burnRate =
    monthsWithSpending.length > 0
      ? monthlyBreakdown.reduce((s, m) => s + m.spent, 0) /
        monthlyBreakdown.length
      : 0;
  const runwayMonths =
    burnRate > 0
      ? Math.round(((totalDonated - totalSpent) / burnRate) * 10) / 10
      : null;

  // Active subscriptions
  const activeSubs = await prisma.subscription.count({
    where: { status: "ACTIVE" },
  });

  const activeSubRecords = await prisma.subscription.findMany({
    where: { status: "ACTIVE" },
    select: { price: true, frequency: true },
  });

  const monthlySubs = activeSubRecords.reduce((sum, sub) => {
    const price = Number(sub.price);
    if (sub.frequency === "YEARLY") return sum + price / 12;
    if (sub.frequency === "ONE_TIME") return sum;
    return sum + price; // MONTHLY
  }, 0);

  return NextResponse.json({
    totalBalance: totalDonated - totalSpent,
    totalDonated,
    totalSpent,
    pendingCount,
    monthlyBreakdown,
    expenseByType,
    burnRate: Math.round(burnRate * 100) / 100,
    runwayMonths,
    activeSubs,
    monthlySubs: Math.round(monthlySubs * 100) / 100,
  });
}
