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
    select: { amount: true, direction: true },
  });

  const totalDonated = approved
    .filter((t) => t.direction === "IN")
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalSpent = approved
    .filter((t) => t.direction === "OUT")
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const pendingCount = await prisma.transaction.count({
    where: { status: "PENDING" },
  });

  return NextResponse.json({
    totalBalance: totalDonated - totalSpent,
    totalDonated,
    totalSpent,
    pendingCount,
  });
}
