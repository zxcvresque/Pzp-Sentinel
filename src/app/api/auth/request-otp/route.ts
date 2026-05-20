import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateOtp } from "@/lib/auth";
import { bot } from "@/lib/bot";

export async function POST(req: NextRequest) {
  const { telegramId } = await req.json();

  if (!telegramId || typeof telegramId !== "string") {
    return NextResponse.json({ error: "Telegram ID is required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { telegramId },
  });

  if (!user) {
    return NextResponse.json({ error: "No account found for this Telegram ID" }, { status: 404 });
  }

  if (user.status !== "ACTIVE") {
    return NextResponse.json({ error: "Account is inactive" }, { status: 403 });
  }

  if (!user.chatId) {
    return NextResponse.json({
      error: "Please start the bot first",
      botLink: `https://t.me/${process.env.BOT_USERNAME}?start=auth`,
    }, { status: 400 });
  }

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: { otpCode: otp, otpExpiresAt: expiresAt },
  });

  try {
    await bot.api.sendMessage(
      user.chatId,
      `🔐 Your Sentinel login code:\n\n<code>${otp}</code>\n\nExpires in 5 minutes. Do not share this code.`,
      { parse_mode: "HTML" }
    );
  } catch {
    return NextResponse.json({ error: "Failed to send OTP. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ success: true, message: "OTP sent to your Telegram" });
}
