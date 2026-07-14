import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const approved = await prisma.transaction.findMany({
    where: { status: "APPROVED", isTest: false },
    select: { amount: true, currency: true, direction: true, type: true, date: true },
  });

  const pendingCount = await prisma.transaction.count({
    where: { status: "PENDING", isTest: false },
  });

  // Currency conversion support
  const searchParams = request.nextUrl.searchParams;
  const displayCurrency = searchParams.get("currency") === "USD" ? "USD" : "INR";

  // Always fetch exchange rate — needed to normalize mixed-currency transactions
  let usdToInr: number | null = null;
  try {
    const rateRes = await fetch(
      new URL("/api/exchange-rate", request.nextUrl.origin).toString(),
    );
    if (rateRes.ok) {
      const rateData = await rateRes.json();
      usdToInr = rateData.rate; // e.g. 84.5
    }
  } catch {
    // fallback below
  }

  // Normalize any amount to the display currency
  const toDisplay = (amount: number, fromCurrency: string): number => {
    if (fromCurrency === displayCurrency) return amount;

    if (!usdToInr) {
      // No rate available — return raw (better than nothing)
      return amount;
    }

    if (fromCurrency === "USD" && displayCurrency === "INR") {
      return amount * usdToInr;
    }
    if (fromCurrency === "INR" && displayCurrency === "USD") {
      return amount / usdToInr;
    }
    return amount;
  };

  const round2 = (n: number) => Math.round(n * 100) / 100;

  const totalDonated = approved
    .filter((t) => t.direction === "IN")
    .reduce((sum, t) => sum + toDisplay(Number(t.amount), t.currency), 0);

  const totalSpent = approved
    .filter((t) => t.direction === "OUT")
    .reduce((sum, t) => sum + toDisplay(Number(t.amount), t.currency), 0);

  // Monthly breakdown for the last 6 months
  const now = new Date();
  const monthlyBreakdown: { month: string; donated: number; spent: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleString("en-US", { month: "short", year: "2-digit" });
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);

    const monthTxns = approved.filter((t) => {
      const td = new Date(t.date);
      return td >= start && td < end;
    });

    const donated = monthTxns
      .filter((t) => t.direction === "IN")
      .reduce((s, t) => s + toDisplay(Number(t.amount), t.currency), 0);
    const spent = monthTxns
      .filter((t) => t.direction === "OUT")
      .reduce((s, t) => s + toDisplay(Number(t.amount), t.currency), 0);

    monthlyBreakdown.push({ month: label, donated: round2(donated), spent: round2(spent) });
  }

  // Expense breakdown by type (OUT direction only)
  const outgoing = approved.filter((t) => t.direction === "OUT");
  const expenseByType: Record<string, number> = {};
  for (const t of outgoing) {
    const typ = t.type || "OTHER";
    expenseByType[typ] = (expenseByType[typ] || 0) + toDisplay(Number(t.amount), t.currency);
  }

  // Burn rate: average monthly OUT spending over last 6 months
  const burnRate =
    monthlyBreakdown.length > 0
      ? monthlyBreakdown.reduce((s, m) => s + m.spent, 0) / monthlyBreakdown.length
      : 0;
  const runwayMonths =
    burnRate > 0
      ? Math.round(((totalDonated - totalSpent) / burnRate) * 10) / 10
      : null;

  // Active services with cost tracking
  const activeSubs = await prisma.service.count({
    where: { status: "ACTIVE", price: { not: null } },
  });

  const activeSubRecords = await prisma.service.findMany({
    where: { status: "ACTIVE", price: { not: null } },
    select: { price: true, currency: true, frequency: true },
  });

  const monthlySubs = activeSubRecords.reduce((sum, sub) => {
    const price = toDisplay(Number(sub.price!), sub.currency ?? "INR");
    if (sub.frequency === "YEARLY") return sum + price / 12;
    if (sub.frequency === "WEEKLY") return sum + (price * 52) / 12;
    if (sub.frequency === "ONE_TIME") return sum;
    return sum + price; // MONTHLY
  }, 0);

  return NextResponse.json({
    totalBalance: round2(totalDonated - totalSpent),
    totalDonated: round2(totalDonated),
    totalSpent: round2(totalSpent),
    pendingCount,
    monthlyBreakdown,
    expenseByType: Object.fromEntries(
      Object.entries(expenseByType).map(([k, v]) => [k, round2(v)]),
    ),
    burnRate: round2(burnRate),
    runwayMonths,
    activeSubs,
    monthlySubs: round2(monthlySubs),
    displayCurrency,
    exchangeRate: usdToInr,
  });
}
