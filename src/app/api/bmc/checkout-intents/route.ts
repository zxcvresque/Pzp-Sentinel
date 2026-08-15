import { NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import {
  BMC_INTENT_TTL_MINUTES,
  generateBmcAttributionCode,
  hashBmcAttributionCode,
} from "@/lib/bmc-attribution";
import { parseDonationFrequency } from "@/lib/donation-frequency";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "DONOR")) {
    return NextResponse.json({ error: "Only approved donors can create a BMC payment reference" }, { status: 403 });
  }
  if (!user.bmcAccess) {
    return NextResponse.json({ error: "Buy Me a Coffee is not enabled for this account" }, { status: 403 });
  }
  const checkoutUrl = process.env.BMC_PAGE_URL?.trim();
  if (!checkoutUrl || !process.env.BMC_WEBHOOK_SECRET?.trim()) {
    return NextResponse.json({ error: "Buy Me a Coffee checkout is not configured" }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const donationFrequency = parseDonationFrequency(body.donationFrequency);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + BMC_INTENT_TTL_MINUTES * 60_000);
  const code = generateBmcAttributionCode();

  const intent = await prisma.$transaction(async (db) => {
    // A newly generated code replaces any unfinished code for this donor. Old
    // codes remain as an audit trail but cannot be consumed after this point.
    await db.bmcCheckoutIntent.updateMany({
      where: { userId: user.id, consumedAt: null, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
    return db.bmcCheckoutIntent.create({
      data: {
        userId: user.id,
        codeHash: hashBmcAttributionCode(code),
        donationFrequency,
        expiresAt,
      },
    });
  });

  await logAudit({
    userId: user.id,
    action: "BMC_CHECKOUT_INTENT",
    entityType: "BmcCheckoutIntent",
    entityId: intent.id,
    after: { expiresAt: expiresAt.toISOString() },
    userName: user.name,
    details: `${user.name} generated a ${donationFrequency === "MONTHLY" ? "monthly" : "one-time"} BMC attribution reference`,
  });

  return NextResponse.json({
    code,
    expiresAt: expiresAt.toISOString(),
    checkoutUrl,
    donationFrequency,
  });
}
