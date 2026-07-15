import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { getOneTimeDonationInvite } from "@/lib/razorpay";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") || "";
  if (token) {
    const invite = await getOneTimeDonationInvite(token);
    if (!invite) return NextResponse.json({ error: "Payment link not found" }, { status: 404 });
    if (!invite.telegramId || !invite.claimedAt) {
      return NextResponse.json({ error: "Verify your identity through Telegram first" }, { status: 403 });
    }
    if (invite.revokedAt || invite.usedAt || invite.expiresAt <= new Date()) {
      return NextResponse.json({ error: "Payment link is no longer available" }, { status: 410 });
    }

    const checkoutUrl = process.env.BMC_PAGE_URL?.trim() || null;
    return NextResponse.json({
      checkoutUrl,
      configured: Boolean(checkoutUrl && process.env.BMC_WEBHOOK_SECRET?.trim()),
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user.roles, "ADMIN") && !hasRole(user.roles, "DONOR")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!hasRole(user.roles, "ADMIN") && !user.bmcAccess) {
    return NextResponse.json({ error: "Buy Me a Coffee is not enabled for this donor" }, { status: 403 });
  }

  const checkoutUrl = process.env.BMC_PAGE_URL?.trim() || null;
  return NextResponse.json({
    checkoutUrl,
    configured: Boolean(checkoutUrl && process.env.BMC_WEBHOOK_SECRET?.trim()),
  }, { headers: { "Cache-Control": "no-store" } });
}
