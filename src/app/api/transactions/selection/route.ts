import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { transactionWhereFromParams } from "@/lib/transaction-query";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const where = transactionWhereFromParams(req.nextUrl.searchParams);
  const rows = await prisma.transaction.findMany({ where, select: { id: true }, take: 5001 });
  if (rows.length > 5000) {
    return NextResponse.json({ error: "The filtered set exceeds 5,000 transactions. Narrow the filters first." }, { status: 400 });
  }
  return NextResponse.json({ ids: rows.map((row) => row.id), total: rows.length });
}
