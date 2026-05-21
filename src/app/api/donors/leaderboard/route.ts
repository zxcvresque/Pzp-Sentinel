import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";

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
    date?: { gte: Date };
  } = {
    status: "APPROVED",
    direction: "IN",
    fromUserId: { not: null },
  };

  if (dateFilter) {
    where.date = { gte: dateFilter };
  }

  const transactions = await prisma.transaction.findMany({
    where,
    select: {
      amount: true,
      fromUserId: true,
      fromUser: { select: { id: true, name: true } },
    },
  });

  // Aggregate by user
  const aggregated: Record<
    string,
    { userId: string; name: string; totalAmount: number; donationCount: number }
  > = {};

  for (const tx of transactions) {
    if (!tx.fromUserId || !tx.fromUser) continue;
    const uid = tx.fromUserId;
    if (!aggregated[uid]) {
      aggregated[uid] = {
        userId: uid,
        name: tx.fromUser.name,
        totalAmount: 0,
        donationCount: 0,
      };
    }
    aggregated[uid].totalAmount += Number(tx.amount);
    aggregated[uid].donationCount += 1;
  }

  // Sort by totalAmount descending and assign rank
  const ranked = Object.values(aggregated)
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .map((entry, index) => ({
      rank: index + 1,
      ...entry,
      totalAmount: Math.round(entry.totalAmount * 100) / 100,
    }));

  return NextResponse.json({ leaderboard: ranked, period });
}
