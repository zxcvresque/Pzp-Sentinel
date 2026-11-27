import "dotenv/config";
import { prisma } from "../src/lib/db";
import { donorPaymentIdentity } from "../src/lib/donor-payment-id";

// Run after db push, before restarting. Preserve currently published IDs; never
// rename old donations to the new transaction-based format during an upgrade.
try {
  let pinned = 0;
  for (;;) {
    const rows = await prisma.transaction.findMany({
      where: { bridgeDonationId: null }, take: 200, orderBy: { id: "asc" },
      select: { id: true, method: true, providerPaymentId: true, bmcEventId: true, razorpayOrder: { select: { paymentId: true } } },
    });
    if (!rows.length) break;
    await prisma.$transaction(rows.map(row => prisma.transaction.updateMany({
      where: { id: row.id, bridgeDonationId: null },
      data: { bridgeDonationId: donorPaymentIdentity(row.method, row.providerPaymentId || row.razorpayOrder?.paymentId || row.bmcEventId, row.id).id },
    })));
    pinned += rows.length;
  }
  console.log(`Preserved ${pinned} existing donation identities.`);
} finally { await prisma.$disconnect(); }
