import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      telegramId: user.telegramId,
      telegramUser: user.telegramUser,
      photoUrl: user.photoUrl,
      themeColor: user.themeColor,
      chatId: user.chatId,
      roles: user.roles,
      createdAt: user.createdAt.toISOString(),
    },
  });
}
