import { after, NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { signToken, highestRole, SESSION_MAX_AGE_SECONDS, verifyOtpHash } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { refreshStoredTelegramAvatar } from "@/lib/telegram-avatar-refresh";
import { setSessionCookies } from "@/lib/session-cookies";
import { consumeRateLimit, requestIp } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const { telegramId, otp } = await req.json();

  if (typeof telegramId !== "string" || !/^\d{5,20}$/.test(telegramId) || !/^\d{6}$/.test(String(otp))) {
    return NextResponse.json({ error: "Telegram ID and OTP are required" }, { status: 400 });
  }

  const ipLimit = await consumeRateLimit({
    scope: "otp-verify",
    identifier: requestIp(req),
    limit: 25,
    windowMs: 15 * 60_000,
  });
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many verification attempts from this network. Try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } },
    );
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
    await prisma.user.updateMany({
      where: { id: user.id, otpCode: user.otpCode },
      data: { otpCode: null, otpExpiresAt: null, otpAttempts: 0 },
    });
    return NextResponse.json({ error: "OTP expired. Please request a new one." }, { status: 401 });
  }

  if (!verifyOtpHash(user.telegramId, String(otp), user.otpCode)) {
    const failure = await prisma.$transaction(async (tx) => {
      const incremented = await tx.user.updateMany({
        where: {
          id: user.id,
          otpCode: user.otpCode,
          otpExpiresAt: { gt: new Date() },
          otpAttempts: { lt: 5 },
          OR: [{ otpLockedUntil: null }, { otpLockedUntil: { lte: new Date() } }],
        },
        data: { otpAttempts: { increment: 1 } },
      });
      if (incremented.count !== 1) return { locked: true };

      const current = await tx.user.findUnique({
        where: { id: user.id },
        select: { otpAttempts: true },
      });
      const locked = (current?.otpAttempts ?? 5) >= 5;
      if (locked) {
        await tx.user.updateMany({
          where: { id: user.id, otpCode: user.otpCode },
          data: {
            otpCode: null,
            otpExpiresAt: null,
            otpLockedUntil: new Date(Date.now() + 15 * 60_000),
          },
        });
      }
      return { locked };
    });
    await logAudit({
      userId: user.id,
      action: "AUTH_OTP_FAILURE",
      entityType: "User",
      entityId: user.id,
      request: req,
      outcome: "FAILURE",
      errorMessage: failure.locked ? "OTP attempt limit reached" : "Invalid OTP",
    });
    return NextResponse.json(
      { error: failure.locked ? "Too many attempts. Try again later." : "Invalid OTP" },
      { status: failure.locked ? 429 : 401 },
    );
  }

  // Only invalidate the OTP before returning success. Avatar archival and
  // audit fan-out run after the browser has received its authenticated session.
  const [consumed, token] = await Promise.all([
    prisma.user.updateMany({
      where: {
        id: user.id,
        otpCode: user.otpCode,
        otpExpiresAt: { gt: new Date() },
        otpAttempts: { lt: 5 },
        OR: [{ otpLockedUntil: null }, { otpLockedUntil: { lte: new Date() } }],
      },
      data: {
        otpCode: null,
        otpExpiresAt: null,
        otpAttempts: 0,
        otpLockedUntil: null,
      },
    }),
    signToken({ userId: user.id, roles: user.roles }),
  ]);
  if (consumed.count !== 1) {
    return NextResponse.json({ error: "OTP was already used or has expired" }, { status: 401 });
  }

  const defaultRole = highestRole(user.roles);
  const redirectMap: Record<string, string> = { ADMIN: "/admin", DEV: "/dev", DONOR: "/donor" };

  const response = NextResponse.json({
    success: true,
    user: { id: user.id, name: user.name, roles: user.roles },
    redirect: redirectMap[defaultRole] || "/donor",
  });

  setSessionCookies(response, token, SESSION_MAX_AGE_SECONDS);

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
