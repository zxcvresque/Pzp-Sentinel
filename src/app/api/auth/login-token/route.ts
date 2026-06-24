import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login-token
 * Generate a login nonce. The frontend opens a deep link to the bot
 * with this nonce; the bot verifies the user and marks it VERIFIED.
 */
export async function POST() {
  const nonce = randomBytes(16).toString("hex"); // 32-char hex
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  await prisma.loginToken.create({
    data: { nonce, expiresAt },
  });

  return NextResponse.json(
    { nonce },
    { headers: { "Cache-Control": "no-store" } },
  );
}
