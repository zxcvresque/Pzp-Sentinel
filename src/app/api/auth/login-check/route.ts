import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { signToken, highestRole } from "@/lib/auth";
import { fetchTelegramPhotoUrl } from "@/lib/bot";

/**
 * GET /api/auth/login-check?nonce=xxx
 * Poll this endpoint to check if the bot has verified the nonce.
 * Once verified → set JWT cookie and return redirect path.
 */
export async function GET(req: NextRequest) {
  const nonce = req.nextUrl.searchParams.get("nonce");
  if (!nonce) {
    return NextResponse.json({ error: "Missing nonce" }, { status: 400 });
  }

  const loginToken = await prisma.loginToken.findUnique({
    where: { nonce },
  });

  if (!loginToken) {
    return NextResponse.json({ error: "Invalid nonce" }, { status: 404 });
  }

  // Expired
  if (loginToken.expiresAt < new Date()) {
    // Clean up
    await prisma.loginToken.delete({ where: { id: loginToken.id } }).catch(() => {});
    return NextResponse.json({ status: "expired" }, { status: 410 });
  }

  // Still waiting for bot verification
  if (loginToken.status === "PENDING") {
    return NextResponse.json({ status: "pending" });
  }

  // Verified — find user, issue JWT
  const telegramId = loginToken.telegramId!;
  const user = await prisma.user.findUnique({ where: { telegramId } });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Clean up the used token
  await prisma.loginToken.delete({ where: { id: loginToken.id } }).catch(() => {});

  if (user.status === "INACTIVE") {
    return NextResponse.json(
      { error: "Your account has been deactivated." },
      { status: 403 },
    );
  }

  if (user.roles.length === 0) {
    return NextResponse.json(
      {
        error: "No roles assigned yet. Ask an admin to assign your role.",
        awaitingRole: true,
        status: "no_role",
      },
      { status: 403 },
    );
  }

  // Refresh profile photo
  const botPhoto = await fetchTelegramPhotoUrl(telegramId).catch(() => null);
  if (botPhoto && botPhoto !== user.photoUrl) {
    await prisma.user.update({
      where: { telegramId },
      data: { photoUrl: botPhoto },
    }).catch(() => {});
  }

  const token = await signToken({ userId: user.id, roles: user.roles });
  const role = highestRole(user.roles);
  const redirect =
    role === "ADMIN" ? "/admin" : role === "DEV" ? "/dev" : "/donor";

  const response = NextResponse.json({
    status: "verified",
    user: { id: user.id, name: user.name, roles: user.roles },
    redirect,
  });

  response.cookies.set("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60,
    path: "/",
  });

  return response;
}
