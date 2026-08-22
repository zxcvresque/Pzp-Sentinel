import { after, NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { signToken, highestRole, SESSION_MAX_AGE_SECONDS, verifyOtpHash } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { refreshStoredTelegramAvatar } from "@/lib/telegram-avatar-refresh";

export async function POST(req: NextRequest) {
  const { telegramId, otp } = await req.json();

  if (typeof telegramId !== "string" || !/^\d{5,20}$/.test(telegramId) || !/^\d{6}$/.test(String(otp))) {
    return NextResponse.json({ error: "Telegram ID and OTP are required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { telegramId },
  });

  if (!user || user.status !== "ACTIVE" || !user.otpCode || !user.otpExpiresAt) {
    return NextResponse.json({ error: "Invalid OTP" }, { status: 401 });
  }

  if (user.otpLockedUntil && user.otpLockedUntil > new Date()) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  if (new Date() > user.otpExpiresAt) {
    await prisma.user.update({
      where: { id: user.id },
      data: { otpCode: null, otpExpiresAt: null, otpAttempts: 0 },
    });
    return NextResponse.json({ error: "OTP expired. Please request a new one." }, { status: 401 });
  }

  if (!verifyOtpHash(user.telegramId, String(otp), user.otpCode)) {
    const attempts = user.otpAttempts + 1;
    const locked = attempts >= 5;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        otpAttempts: attempts,
        ...(locked ? {
          otpCode: null,
          otpExpiresAt: null,
          otpLockedUntil: new Date(Date.now() + 15 * 60_000),
        } : {}),
      },
    });
    await logAudit({
      userId: user.id,
      action: "AUTH_OTP_FAILURE",
      entityType: "User",
      entityId: user.id,
      request: req,
      outcome: "FAILURE",
      errorMessage: locked ? "OTP attempt limit reached" : "Invalid OTP",
    });
    return NextResponse.json({ error: "Invalid OTP" }, { status: 401 });
  }

  // Only invalidate the OTP before returning success. Avatar archival and
  // audit fan-out run after the browser has received its authenticated session.
  const [, token] = await Promise.all([
    prisma.user.update({
      where: { id: user.id },
      data: {
        otpCode: null,
        otpExpiresAt: null,
        otpAttempts: 0,
        otpLockedUntil: null,
      },
    }),
    signToken({ userId: user.id, roles: user.roles }),
  ]);

  const defaultRole = highestRole(user.roles);
  const redirectMap: Record<string, string> = { ADMIN: "/admin", DEV: "/dev", DONOR: "/donor" };

  const response = NextResponse.json({
    success: true,
    user: { id: user.id, name: user.name, roles: user.roles },
    redirect: redirectMap[defaultRole] || "/donor",
  });

  response.cookies.set("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });

  after(async () => {
    await Promise.allSettled([
      refreshStoredTelegramAvatar({
        userId: user.id,
        telegramId: user.telegramId,
        userName: user.name,
      }),
      logAudit({
        userId: user.id,
        action: "AUTH_OTP_SUCCESS",
        entityType: "User",
        entityId: user.id,
        request: req,
        userName: user.name,
      }),
    ]);
  });

  return response;
}
