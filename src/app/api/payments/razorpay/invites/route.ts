import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createOneTimeDonationInvite, RazorpayError } from "@/lib/razorpay";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

async function admin() {
  const user = await getCurrentUser();
  return user && hasRole(user.roles, "ADMIN") ? user : null;
}

export async function GET() {
  const user = await admin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const invites = await prisma.oneTimeDonationInvite.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { order: { select: { status: true, transactionId: true, amount: true, testMode: true } } },
  });
  return NextResponse.json({ invites });
}

export async function POST(request: NextRequest) {
  const user = await admin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  try {
    const body = await request.json();
    const botUsername = process.env.BOT_USERNAME?.trim().replace(/^@/, "");
    if (!botUsername) throw new RazorpayError("BOT_USERNAME is not configured", 503);
    const { invite, token } = await createOneTimeDonationInvite({
      createdById: user.id,
      guestName: body.guestName,
      note: body.note,
      expiresInHours: body.expiresInHours,
    });
    await logAudit({
      userId: user.id,
      action: "RAZORPAY_INVITE_CREATE",
      entityType: "OneTimeDonationInvite",
      entityId: invite.id,
      after: { guestName: invite.guestName, expiresAt: invite.expiresAt },
      userName: user.name,
      details: `${invite.guestName} · awaiting Telegram identity claim`,
    });
    return NextResponse.json({ invite, botLink: `https://t.me/${botUsername}?start=donate_${token}` }, { status: 201 });
  } catch (error) {
    const status = error instanceof RazorpayError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create link" }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  const user = await admin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const result = await prisma.oneTimeDonationInvite.updateMany({
    where: { id, usedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!result.count) return NextResponse.json({ error: "Active link not found" }, { status: 404 });
  await logAudit({
    userId: user.id,
    action: "RAZORPAY_INVITE_REVOKE",
    entityType: "OneTimeDonationInvite",
    entityId: id,
    userName: user.name,
  });
  return NextResponse.json({ ok: true });
}
