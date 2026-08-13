import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { notify, formatTgMessage } from "@/lib/notifications";
import { escapeTelegramHtml } from "@/lib/telegram-format";

export const runtime = "nodejs";

async function requireAdmin() {
  const user = await getCurrentUser();
  return user && hasRole(user.roles, "ADMIN") ? user : null;
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const donors = await prisma.user.findMany({
    where: { roles: { has: "DONOR" }, status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      telegramUser: true,
      photoUrl: true,
      bmcAccess: true,
      razorpayAccess: true,
      razorpayAccessRequestedAt: true,
    },
  });
  donors.sort((a, b) => Number(Boolean(b.razorpayAccessRequestedAt)) - Number(Boolean(a.razorpayAccessRequestedAt)) || a.name.localeCompare(b.name));
  return NextResponse.json({ donors }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const provider = body?.provider === "BMC" || body?.provider === "RAZORPAY" ? body.provider : null;
  const allowed = typeof body?.allowed === "boolean" ? body.allowed : null;
  if (!userId || !provider || allowed === null) {
    return NextResponse.json({ error: "User, provider, and allowed state are required" }, { status: 400 });
  }

  const donor = await prisma.user.findFirst({
    where: { id: userId, roles: { has: "DONOR" }, status: "ACTIVE" },
  });
  if (!donor) return NextResponse.json({ error: "Active donor not found" }, { status: 404 });

  const updated = await prisma.user.update({
    where: { id: donor.id },
    data: provider === "BMC"
      ? { bmcAccess: allowed }
      : { razorpayAccess: allowed, razorpayAccessRequestedAt: null },
    select: {
      id: true,
      bmcAccess: true,
      razorpayAccess: true,
      razorpayAccessRequestedAt: true,
    },
  });

  await logAudit({
    userId: admin.id,
    action: "DONOR_PAYMENT_ACCESS",
    entityType: "User",
    entityId: donor.id,
    before: provider === "BMC" ? { bmcAccess: donor.bmcAccess } : { razorpayAccess: donor.razorpayAccess },
    after: provider === "BMC" ? { bmcAccess: allowed } : { razorpayAccess: allowed },
    userName: admin.name,
    details: `${provider} ${allowed ? "allowed for" : "disabled for"} ${donor.name}`,
  });

  if (provider === "RAZORPAY" && allowed && !donor.razorpayAccess) {
    await notify({
      userId: donor.id,
      type: "SYSTEM",
      title: "Razorpay is now available",
      message: "Your Razorpay checkout access was approved. You can now pay by UPI, cards, wallets, and netbanking in Sentinel.",
      entityId: `razorpay-access:${donor.id}`,
      priority: "HIGH",
      actionUrl: "/donor",
      actionLabel: "Open payment options",
      telegramMessage: formatTgMessage(
        "Razorpay Access Approved",
        `Razorpay and UPI checkout is now enabled for ${escapeTelegramHtml(donor.name)}.`,
        "Open Sentinel to use UPI, cards, wallets, or netbanking.",
      ),
    });
  }

  return NextResponse.json({ donor: updated });
}
