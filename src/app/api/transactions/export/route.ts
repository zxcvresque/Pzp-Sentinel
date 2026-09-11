import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { transactionOrderFromParams, transactionWhereFromParams } from "@/lib/transaction-query";
import { donorPaymentIdentity } from "@/lib/donor-payment-id";

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
      fromUser: { select: { name: true, telegramId: true } },
      razorpayOrder: { select: { paymentId: true, invite: { select: { telegramId: true, guestName: true } } } },
    },
  });

  // CSV header
  const headers = [
    "Telegram User ID",
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
    "Donation ID", "Provider Payment ID", "Transaction ID", "Occurred At UTC",
    "Donation Frequency", "Provider State", "Provider Verified", "Manually Reviewed", "Is Test",
  ];

  function escapeCsv(val: string): string {
    // Prevent descriptions/names from executing as formulas in spreadsheet apps.
    if (/^[=+@\-\t\r]/.test(val)) val = "'" + val;
    if (val.includes(",") || val.includes('"') || val.includes("\n") || val.includes("\r")) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  }

  const rows = transactions.map((tx) => [
    tx.fromUser?.telegramId || tx.razorpayOrder?.invite?.telegramId || "",
    displayDate(tx.date),
    escapeCsv(tx.description),
    Number(tx.amount).toFixed(2),
    tx.currency,
    tx.method,
    tx.direction,
    tx.type,
    escapeCsv(tx.fromUser?.name || tx.razorpayOrder?.invite?.guestName || ""),
    tx.status,
    tx.voidedAt ? "VOIDED" : "ACTIVE",
    escapeCsv(tx.voidReason || ""),
    escapeCsv(donorPaymentIdentity(tx.method, tx.providerPaymentId || tx.razorpayOrder?.paymentId || tx.bmcEventId, tx.id).id),
    escapeCsv(donorPaymentIdentity(tx.method, tx.providerPaymentId || tx.razorpayOrder?.paymentId || tx.bmcEventId, tx.id).paymentId),
    tx.id, new Date(tx.date).toISOString(), tx.donationFrequency, tx.providerState || "",
    String(tx.providerVerified), String(Boolean(tx.reviewedById)), String(tx.isTest),
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
import { displayDate } from "@/lib/date-format";
