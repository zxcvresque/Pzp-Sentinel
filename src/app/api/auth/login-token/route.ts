import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { consumeRateLimit, requestIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login-token
 * Generate a login nonce. The frontend opens a deep link to the bot
 * with this nonce; the bot verifies the user and marks it VERIFIED.
 */
export async function POST(req: NextRequest) {
  const rateLimit = await consumeRateLimit({
    scope: "login-token",
    identifier: requestIp(req),
    limit: 10,
    windowMs: 10 * 60_000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many login links requested. Try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  // Opportunistic cleanup complements the bot process's scheduled cleanup and
  // also protects installations that temporarily run only the web process.
  await prisma.loginToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });

  const nonce = randomBytes(16).toString("hex"); // 32-char hex
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  await prisma.loginToken.create({
    data: { nonce, expiresAt },
  });

  return NextResponse.json(
    { nonce, expiresAt: expiresAt.toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
