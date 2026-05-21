import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { Prisma } from "@/generated/prisma/client";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const searchParams = request.nextUrl.searchParams;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const direction = searchParams.get("direction");
  const status = searchParams.get("status");

  const where: Prisma.TransactionWhereInput = {
    status: "APPROVED",
  };

  // Override status filter if explicitly provided
  if (status && status !== "ALL") {
    where.status = status as "PENDING" | "APPROVED" | "REJECTED";
  }

  if (direction && direction !== "ALL") {
    where.direction = direction as "IN" | "OUT";
  }

  if (from || to) {
    where.date = {};
    if (from) (where.date as Prisma.DateTimeFilter).gte = new Date(from);
    if (to) (where.date as Prisma.DateTimeFilter).lte = new Date(to);
  }

  const transactions = await prisma.transaction.findMany({
    where,
    orderBy: { date: "desc" },
    include: {
      fromUser: { select: { name: true } },
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
