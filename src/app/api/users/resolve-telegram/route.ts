import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { normalizeTelegramUsername, resolveRegisteredTelegramUser } from "@/lib/telegram-identity";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser || !hasRole(currentUser.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const username = normalizeTelegramUsername(request.nextUrl.searchParams.get("username"));
  if (!username) {
    return NextResponse.json({ error: "Enter a Telegram username" }, { status: 400 });
  }

  const user = await resolveRegisteredTelegramUser(username);
  if (!user) return NextResponse.json({ found: false });

  return NextResponse.json({
    found: true,
    user: {
      name: user.name,
      telegramId: user.telegramId,
      telegramUser: user.telegramUser,
    },
  });
}
