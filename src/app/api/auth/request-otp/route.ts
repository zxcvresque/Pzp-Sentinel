import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateOtp, hashOtp } from "@/lib/auth";
import { bot } from "@/lib/bot";

export async function POST(req: NextRequest) {
  const { telegramId } = await req.json();

  if (!telegramId || typeof telegramId !== "string" || !/^\d{5,20}$/.test(telegramId)) {
    return NextResponse.json({ error: "Telegram ID is required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { telegramId },
  });

  // Do not disclose whether an ID exists, is inactive, or has linked the bot.
  const generic = () => NextResponse.json({
    success: true,
    message: "If this Telegram account can sign in, a code has been sent.",
  });
  if (!user || user.status !== "ACTIVE" || !user.chatId) return generic();

  const now = new Date();
  if (user.otpLockedUntil && user.otpLockedUntil > now) {
    return generic();
  }
  if (user.otpRequestedAt && now.getTime() - user.otpRequestedAt.getTime() < 60_000) {
    return generic();
  }

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      otpCode: hashOtp(telegramId, otp),
      otpExpiresAt: expiresAt,
      otpAttempts: 0,
      otpRequestedAt: now,
      otpLockedUntil: null,
    },
  });

  try {
    await bot.api.sendMessage(
      user.chatId,
      `<blockquote><b>Login Code</b></blockquote>\n` +
      `<code>${otp}</code>\n\n` +
      `<i>Expires in 5 minutes. Do not share this code.</i>`,
      {
        parse_mode: "HTML",
        disable_notification: true,
      },
    );
  } catch {
    await prisma.user.update({
      where: { id: user.id },
      data: { otpCode: null, otpExpiresAt: null },
    }).catch(() => undefined);
    return NextResponse.json({ error: "Failed to send OTP. Please try again." }, { status: 500 });
  }

  return generic();
}
