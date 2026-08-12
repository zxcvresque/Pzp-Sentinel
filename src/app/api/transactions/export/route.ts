import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { transactionOrderFromParams, transactionWhereFromParams } from "@/lib/transaction-query";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const searchParams = request.nextUrl.searchParams;
  const where = transactionWhereFromParams(searchParams);
  const orderBy = transactionOrderFromParams(searchParams);

  const transactions = await prisma.transaction.findMany({
    where,
    orderBy,
    include: {
      fromUser: { select: { name: true, photoUrl: true, telegramUser: true } },
    },
  });

  // CSV header
  const headers = [
    "Date",
    "Description",
    "Amount",
    "Currency",
    "Method",
    "Direction",
    "Type",
    "From",
    "Status",
    "Lifecycle",
    "Void Reason",
  ];

  function escapeCsv(val: string): string {
    if (val.includes(",") || val.includes('"') || val.includes("\n")) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  }

  const rows = transactions.map((tx) => [
    new Date(tx.date).toISOString().split("T")[0],
    escapeCsv(tx.description),
    Number(tx.amount).toFixed(2),
    tx.currency,
    tx.method,
    tx.direction,
    tx.type,
    escapeCsv(tx.fromUser?.name || ""),
    tx.status,
    tx.voidedAt ? "VOIDED" : "ACTIVE",
    escapeCsv(tx.voidReason || ""),
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

  const today = new Date().toISOString().split("T")[0];
  const filename = `sentinel-transactions-${today}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
