import { after, NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { signToken, highestRole, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";
import { refreshStoredTelegramAvatar } from "@/lib/telegram-avatar-refresh";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/login-check?nonce=xxx
 * Poll this endpoint to check if the bot has verified the nonce.
 * Once verified, set the JWT cookie and return the redirect path.
 */
export async function GET(req: NextRequest) {
  const noStore = { headers: { "Cache-Control": "no-store" } };
  const nonce = req.nextUrl.searchParams.get("nonce");
  if (!nonce) {
    return NextResponse.json({ error: "Missing nonce" }, { status: 400, ...noStore });
  }

  const loginToken = await prisma.loginToken.findUnique({
    where: { nonce },
  });

  if (!loginToken) {
    return NextResponse.json({ error: "Invalid nonce" }, { status: 404, ...noStore });
  }

  if (loginToken.expiresAt < new Date()) {
    await prisma.loginToken.delete({ where: { id: loginToken.id } }).catch(() => {});
    return NextResponse.json({ status: "expired" }, { status: 410, ...noStore });
  }

  if (loginToken.status === "PENDING") {
    return NextResponse.json({ status: "pending" }, noStore);
  }

  const telegramId = loginToken.telegramId!;
  const [user] = await Promise.all([
    prisma.user.findUnique({ where: { telegramId } }),
    prisma.loginToken.delete({ where: { id: loginToken.id } }).catch(() => undefined),
  ]);

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404, ...noStore });
  }

  if (user.status === "INACTIVE") {
    return NextResponse.json(
      { error: "Your account has been deactivated." },
      { status: 403, ...noStore },
    );
  }

  if (user.roles.length === 0) {
    return NextResponse.json(
      {
        error: "No roles assigned yet. Ask an admin to assign your role.",
        awaitingRole: true,
        status: "no_role",
      },
      { status: 403, ...noStore },
    );
  }

  const token = await signToken({ userId: user.id, roles: user.roles });
  const role = highestRole(user.roles);
  const redirect =
    role === "ADMIN" ? "/admin" : role === "DEV" ? "/dev" : "/donor";

  const response = NextResponse.json({
    status: "verified",
    user: { id: user.id, name: user.name, roles: user.roles },
    redirect,
  }, noStore);

  response.cookies.set("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });

  after(() => refreshStoredTelegramAvatar({
    userId: user.id,
    telegramId,
    userName: user.name,
  }));

  return response;
}
