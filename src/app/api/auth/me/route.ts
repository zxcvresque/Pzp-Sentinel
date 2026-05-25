import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NotifType } from "@/generated/prisma/enums";

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
      dmPreferences: user.dmPreferences,
      createdAt: user.createdAt.toISOString(),
    },
  });
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { dmPreferences } = body;

  if (!Array.isArray(dmPreferences)) {
    return NextResponse.json(
      { error: "dmPreferences must be an array" },
      { status: 400 },
    );
  }

  const validTypes = Object.values(NotifType) as string[];
  const invalid = dmPreferences.filter((t: string) => !validTypes.includes(t));
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `Invalid notification types: ${invalid.join(", ")}` },
      { status: 400 },
    );
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { dmPreferences },
    select: { dmPreferences: true },
  });

  return NextResponse.json({ dmPreferences: updated.dmPreferences });
}
