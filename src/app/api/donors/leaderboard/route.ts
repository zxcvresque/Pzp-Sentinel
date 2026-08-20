import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { isEligibleLeaderboardDonation } from "@/lib/donation-leaderboard";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const searchParams = request.nextUrl.searchParams;
  const period = searchParams.get("period") || "all";

  // Build date filter
  const now = new Date();
  let dateFilter: Date | undefined;

  if (period === "year") {
    dateFilter = new Date(now.getFullYear(), 0, 1);
  } else if (period === "month") {
    dateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  // Find all approved IN transactions with a fromUserId
  const where: {
    status: "APPROVED";
    direction: "IN";
    fromUserId: { not: null };
    isTest: false;
    voidedAt: null;
    date?: { gte: Date };
  } = {
    status: "APPROVED",
    direction: "IN",
    fromUserId: { not: null },
    isTest: false,
    voidedAt: null,
  };

  if (dateFilter) {
    where.date = { gte: dateFilter };
  }

  const transactions = await prisma.transaction.findMany({
    where,
    select: {
      amount: true,
      currency: true,
      method: true,
      fromUserId: true,
      createdById: true,
      bmcEventId: true,
      providerPaymentId: true,
      razorpaySubscriptionId: true,
      fromUser: { select: { id: true, name: true, photoUrl: true, telegramUser: true, roles: true } },
    },
  });

  // The display keeps each donation in its original currency, but ranks still
  // need one comparable value. Use the same cached rate endpoint as treasury
  // statistics; if it is temporarily unavailable, retain the former raw-order
  // fallback rather than failing the leaderboard.
  let usdToInr: number | null = null;
  try {
    const rateResponse = await fetch(new URL("/api/exchange-rate", request.nextUrl.origin).toString());
    if (rateResponse.ok) {
      const data = await rateResponse.json() as { rate?: unknown };
      usdToInr = typeof data.rate === "number" && data.rate > 0 ? data.rate : null;
    }
  } catch {
    // Currency labels remain accurate even if ranking cannot be normalized.
  }

  // Aggregate by user
  const aggregated: Record<
    string,
    {
      userId: string;
      name: string;
      photoUrl: string | null;
      telegramUser: string | null;
      rankingAmount: number;
      amounts: { currency: "INR" | "USD"; amount: number }[];
      contributions: { method: string; currency: "INR" | "USD"; amount: number }[];
      hasUsd: boolean;
      donationCount: number;
    }
  > = {};

  for (const tx of transactions) {
    if (!tx.fromUserId || !tx.fromUser) continue;
    if (!isEligibleLeaderboardDonation({
      fromUserId: tx.fromUserId,
      fromUserRoles: tx.fromUser.roles,
      createdById: tx.createdById,
      providerCaptured: Boolean(tx.bmcEventId || tx.providerPaymentId || tx.razorpaySubscriptionId),
    })) continue;
    const uid = tx.fromUserId;
    if (!aggregated[uid]) {
      aggregated[uid] = {
        userId: uid,
        name: tx.fromUser.name,
        photoUrl: tx.fromUser.photoUrl,
        telegramUser: tx.fromUser.telegramUser,
        rankingAmount: 0,
        amounts: [],
        contributions: [],
        hasUsd: false,
        donationCount: 0,
      };
    }
    const entry = aggregated[uid];
    const amount = Number(tx.amount);
    const currency = tx.currency as "INR" | "USD";
    const existingAmount = entry.amounts.find((item) => item.currency === currency);
    if (existingAmount) existingAmount.amount += amount;
    else entry.amounts.push({ currency, amount });
    const existingContribution = entry.contributions.find(
      (item) => item.method === tx.method && item.currency === currency,
    );
    if (existingContribution) existingContribution.amount += amount;
    else entry.contributions.push({ method: tx.method, currency, amount });
    if (currency === "USD") entry.hasUsd = true;
    entry.rankingAmount += currency === "USD" && usdToInr ? amount * usdToInr : amount;
    entry.donationCount += 1;
  }

  // Sort by the normalized comparison value and assign rank.
  const ranked = Object.values(aggregated)
    .sort((a, b) => b.rankingAmount - a.rankingAmount)
    .map(({ rankingAmount, hasUsd, ...entry }, index) => ({
      rank: index + 1,
      ...entry,
      totalInr: !hasUsd || usdToInr ? Math.round(rankingAmount * 100) / 100 : null,
      amounts: entry.amounts
        .map((item) => ({ ...item, amount: Math.round(item.amount * 100) / 100 }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
      contributions: entry.contributions
        .map((item) => ({ ...item, amount: Math.round(item.amount * 100) / 100 }))
        .sort((a, b) => {
          const providerOrder: Record<string, number> = { BMC: 0, RAZORPAY: 1 };
          return (providerOrder[a.method] ?? 9) - (providerOrder[b.method] ?? 9)
            || a.currency.localeCompare(b.currency);
        }),
    }));

  return NextResponse.json({ leaderboard: ranked, period, exchangeRate: usdToInr });
}
