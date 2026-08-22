import { after, NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { prisma } from "@/lib/db";
import { signToken, highestRole, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";
import { refreshStoredTelegramAvatar } from "@/lib/telegram-avatar-refresh";

function validateInitData(initData: string, botToken: string): Record<string, string> | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;

  params.delete("hash");
  const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (computed !== hash) return null;

  const authDate = params.get("auth_date");
  if (authDate) {
    const age = Math.floor(Date.now() / 1000) - parseInt(authDate);
    if (age > 86400) return null;
  }

  return Object.fromEntries(entries);
}

export async function POST(req: NextRequest) {
  const { initData } = await req.json();
  if (!initData) {
    return NextResponse.json({ error: "initData is required" }, { status: 400 });
  }

  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const validated = validateInitData(initData, botToken);
  if (!validated) {
    return NextResponse.json({ error: "Invalid or expired initData" }, { status: 401 });
  }

  const userJson = validated["user"];
  if (!userJson) {
    return NextResponse.json({ error: "No user in initData" }, { status: 400 });
  }

  let tgUser: { id: number; username?: string; first_name?: string; last_name?: string; photo_url?: string };
  try {
    tgUser = JSON.parse(userJson);
  } catch {
    return NextResponse.json({ error: "Malformed user data" }, { status: 400 });
  }

  const telegramId = String(tgUser.id);
  const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || "User";

  let user = await prisma.user.findUnique({ where: { telegramId } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        telegramId,
        telegramUser: tgUser.username || "",
        name,
        roles: [],
        status: "ACTIVE",
      },
    });
  }

  const storedUser = user;
  after(async () => {
    await Promise.allSettled([
      refreshStoredTelegramAvatar({
        userId: storedUser.id,
        telegramId,
        userName: name,
      }),
      prisma.user.update({
        where: { id: storedUser.id },
        data: {
          telegramUser: tgUser.username || storedUser.telegramUser,
          name,
        },
      }),
    ]);
  });

  if (user.roles.length === 0) {
    return NextResponse.json({
      error: "No roles assigned yet. Ask an admin to assign your role.",
      awaitingRole: true,
    }, { status: 403 });
  }

  if (user.status === "INACTIVE") {
    return NextResponse.json(
      { error: "Your account has been deactivated." },
      { status: 403 },
    );
  }

  const token = await signToken({ userId: user.id, roles: user.roles });
  const role = highestRole(user.roles);
  const redirect = role === "ADMIN" ? "/admin" : role === "DEV" ? "/dev" : "/donor";

  const response = NextResponse.json({
    success: true,
    user: { id: user.id, name: user.name, roles: user.roles },
    redirect,
  });

  response.cookies.set("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });

  return response;
}
