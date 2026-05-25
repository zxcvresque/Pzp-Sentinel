import { NextRequest, NextResponse } from "next/server";
import { createHash, createHmac } from "crypto";
import { prisma } from "@/lib/db";
import { signToken, highestRole } from "@/lib/auth";
import { fetchTelegramPhotoUrl } from "@/lib/bot";

/**
 * Verify Telegram Login Widget callback data.
 * Different from initData — uses SHA256(bot_token) as HMAC key.
 * https://core.telegram.org/widgets/login#checking-authorization
 */
function validateWidgetData(
  data: Record<string, string>,
  botToken: string,
): boolean {
  const hash = data.hash;
  if (!hash) return false;

  // Build check string: sorted key=value pairs (excluding hash)
  const checkString = Object.keys(data)
    .filter((k) => k !== "hash")
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join("\n");

  const secretKey = createHash("sha256").update(botToken).digest();
  const computed = createHmac("sha256", secretKey)
    .update(checkString)
    .digest("hex");

  if (computed !== hash) return false;

  // Check auth_date is within 24 hours
  const authDate = parseInt(data.auth_date || "0");
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age > 86400) return false;

  return true;
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  if (!validateWidgetData(body, botToken)) {
    return NextResponse.json(
      { error: "Invalid or expired Telegram auth" },
      { status: 401 },
    );
  }

  const telegramId = String(body.id);
  const name =
    [body.first_name, body.last_name].filter(Boolean).join(" ") || "User";
  const username = body.username || "";

  // Fetch full-res profile photo from Bot API
  const botPhoto = await fetchTelegramPhotoUrl(telegramId);
  const photoUrl = botPhoto || body.photo_url || null;

  let user = await prisma.user.findUnique({ where: { telegramId } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        telegramId,
        telegramUser: username,
        name,
        photoUrl,
        roles: [],
        status: "ACTIVE",
      },
    });
  } else {
    user = await prisma.user.update({
      where: { telegramId },
      data: {
        telegramUser: username || user.telegramUser,
        name,
        photoUrl: photoUrl || user.photoUrl,
      },
    });
  }

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
      },
      { status: 403 },
    );
  }

  const token = await signToken({ userId: user.id, roles: user.roles });
  const role = highestRole(user.roles);
  const redirect =
    role === "ADMIN" ? "/admin" : role === "DEV" ? "/dev" : "/donor";

  const response = NextResponse.json({
    success: true,
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
