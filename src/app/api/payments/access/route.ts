import { NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notifyAdmins, formatTgMessage } from "@/lib/notifications";
import { escapeTelegramHtml, formatTelegramIdentity } from "@/lib/telegram-format";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || (!hasRole(user.roles, "DONOR") && !hasRole(user.roles, "ADMIN"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  return NextResponse.json({
    access: {
      bmc: hasRole(user.roles, "ADMIN") || user.bmcAccess,
      razorpay: hasRole(user.roles, "ADMIN") || user.razorpayAccess,
      razorpayRequested: Boolean(user.razorpayAccessRequestedAt),
      razorpayRequestedAt: user.razorpayAccessRequestedAt?.toISOString() || null,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "DONOR")) {
    return NextResponse.json({ error: "Only active donors can request Razorpay access" }, { status: 403 });
  }
  if (user.razorpayAccess) {
    return NextResponse.json({ access: { razorpay: true, razorpayRequested: false } });
  }

  const requestedAt = new Date();
  const changed = await prisma.user.updateMany({
    where: { id: user.id, razorpayAccess: false, razorpayAccessRequestedAt: null },
    data: { razorpayAccessRequestedAt: requestedAt },
  });

  if (changed.count === 1) {
    await logAudit({
      userId: user.id,
      action: "RAZORPAY_ACCESS_REQUEST",
      entityType: "User",
      entityId: user.id,
      before: { razorpayAccess: false, razorpayAccessRequestedAt: null },
      after: { razorpayAccess: false, razorpayAccessRequestedAt: requestedAt.toISOString() },
      userName: user.name,
      details: `${user.name} requested Razorpay access`,
    });
    await notifyAdmins({
      type: "SYSTEM",
      title: "Razorpay access requested",
      message: `${user.name} requested access to Razorpay and UPI checkout.`,
      entityId: `razorpay-access:${user.id}`,
      priority: "HIGH",
      actionUrl: "/admin/donors",
      actionLabel: "Review request",
      telegramMessage: formatTgMessage(
        "Razorpay Access Request",
        `${escapeTelegramHtml(user.name)} requested Razorpay and UPI checkout`,
        formatTelegramIdentity({ name: user.name, username: user.telegramUser, telegramId: user.telegramId }),
      ),
    });
  }

  return NextResponse.json({
    access: { razorpay: false, razorpayRequested: true, razorpayRequestedAt: requestedAt.toISOString() },
  });
}
