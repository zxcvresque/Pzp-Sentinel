import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { signToken, highestRole } from "@/lib/auth";
import { cookies } from "next/headers";

export async function POST(req: NextRequest) {
  const { telegramId, otp } = await req.json();

  if (!telegramId || !otp) {
    return NextResponse.json({ error: "Telegram ID and OTP are required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { telegramId },
  });

  if (!user || !user.otpCode || !user.otpExpiresAt) {
    return NextResponse.json({ error: "Invalid OTP" }, { status: 401 });
  }

  if (new Date() > user.otpExpiresAt) {
    await prisma.user.update({
      where: { id: user.id },
      data: { otpCode: null, otpExpiresAt: null },
    });
    return NextResponse.json({ error: "OTP expired. Please request a new one." }, { status: 401 });
  }

  if (user.otpCode !== otp) {
    return NextResponse.json({ error: "Invalid OTP" }, { status: 401 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { otpCode: null, otpExpiresAt: null },
  });

  const token = signToken({ userId: user.id, roles: user.roles });

  const cookieStore = await cookies();
  cookieStore.set("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60,
    path: "/",
  });

  const defaultRole = highestRole(user.roles);
  const redirectMap = { ADMIN: "/admin", DEV: "/dev", DONOR: "/donor" } as const;

  return NextResponse.json({
    success: true,
    user: { id: user.id, name: user.name, roles: user.roles },
    redirect: redirectMap[defaultRole],
  });
}
