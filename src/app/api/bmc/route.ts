import { NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only ADMIN can access BMC financial data
  if (!hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Get all BMC transactions from our database
    const bmcTransactions = await prisma.transaction.findMany({
      where: {
        method: "BMC",
        status: "APPROVED",
      },
      orderBy: { date: "desc" },
      select: {
        id: true,
        amount: true,
        currency: true,
        description: true,
        date: true,
        bmcEventId: true,
      },
    });

    const totalEarned = bmcTransactions.reduce(
      (sum, tx) => sum + parseFloat(tx.amount.toString()),
      0,
    );

    const totalSupporters = new Set(
      bmcTransactions
        .map((tx) => {
          // Extract supporter name from description pattern "BMC: Name x..."
          const match = tx.description.match(/^BMC(?:\sExtra)?:\s+(.+?)(?:\s+x\d|\s+-)/);
          return match ? match[1] : null;
        })
        .filter(Boolean),
    ).size;

    const recent = bmcTransactions.slice(0, 10).map((tx) => ({
      id: tx.id,
      amount: tx.amount.toString(),
      currency: tx.currency,
      description: tx.description,
      date: tx.date.toISOString(),
      bmcEventId: tx.bmcEventId,
    }));

    return NextResponse.json({
      totalSupporters,
      totalEarned: Math.round(totalEarned * 100) / 100,
      totalTransactions: bmcTransactions.length,
      recent,
    });
  } catch (err) {
    console.error("BMC stats error:", err);
    return NextResponse.json(
      { error: "Failed to fetch BMC stats" },
      { status: 500 },
    );
  }
}
