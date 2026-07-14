import { NextRequest, NextResponse } from "next/server";
import { getOneTimeDonationInvite } from "@/lib/razorpay";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") || "";
  const invite = await getOneTimeDonationInvite(token);
  if (!invite) return NextResponse.json({ error: "Payment link not found" }, { status: 404 });
  const state = invite.revokedAt ? "REVOKED" : invite.usedAt ? "USED" : invite.expiresAt <= new Date() ? "EXPIRED" : "ACTIVE";
  return NextResponse.json({
    invite: {
      guestName: invite.guestName,
      telegramUser: invite.telegramUser,
      note: invite.note,
      expiresAt: invite.expiresAt,
      state,
    },
  });
}
