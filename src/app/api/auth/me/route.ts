import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NotifType, DonateCadence } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      telegramId: user.telegramId,
      telegramUser: user.telegramUser,
      photoUrl: user.photoUrl,
      themeColor: user.themeColor,
      savedColors: user.savedColors,
      chatId: user.chatId,
      roles: user.roles,
      dmPreferences: user.dmPreferences,
      donateReminderCadence: user.donateReminderCadence,
      createdAt: user.createdAt.toISOString(),
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { dmPreferences, donateReminderCadence } = body;

  const data: { dmPreferences?: string[]; donateReminderCadence?: DonateCadence } = {};

  if (dmPreferences !== undefined) {
    if (!Array.isArray(dmPreferences)) {
      return NextResponse.json({ error: "dmPreferences must be an array" }, { status: 400 });
    }
    const validTypes = Object.values(NotifType) as string[];
    const invalid = dmPreferences.filter((t: string) => !validTypes.includes(t));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Invalid notification types: ${invalid.join(", ")}` },
        { status: 400 },
      );
    }
    data.dmPreferences = dmPreferences;
  }

  if (donateReminderCadence !== undefined) {
    const valid = Object.values(DonateCadence) as string[];
    if (!valid.includes(donateReminderCadence)) {
      return NextResponse.json({ error: "Invalid donateReminderCadence" }, { status: 400 });
    }
    data.donateReminderCadence = donateReminderCadence as DonateCadence;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data,
    select: { dmPreferences: true, donateReminderCadence: true },
  });

  return NextResponse.json(updated);
}
