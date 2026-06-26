import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser, signToken, verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NotifType, DonateCadence } from "@/generated/prisma/enums";
import type { Role } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

function rolesEqual(a: Role[], b: Role[]): boolean {
  if (a.length !== b.length) return false;
  const sortedB = [...b].sort();
  return [...a].sort().every((r, i) => r === sortedB[i]);
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const res = NextResponse.json({
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

  // Keep the auth cookie's role snapshot in sync with the DB. Middleware authorizes
  // /admin, /dev, /donor from the JWT roles (the Edge runtime can't query Prisma), so
  // a role added or removed after login otherwise wouldn't take effect until the 24h
  // token expired. The app fetches this endpoint on load, so re-mint the cookie here
  // when the DB roles drift from the token — preserving the original expiry.
  const token = (await cookies()).get("token")?.value;
  const payload = token ? await verifyToken(token) : null;
  if (payload?.exp && !rolesEqual(payload.roles, user.roles)) {
    const remaining = payload.exp - Math.floor(Date.now() / 1000);
    if (remaining > 0) {
      const fresh = await signToken({ userId: user.id, roles: user.roles }, payload.exp);
      res.cookies.set("token", fresh, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: remaining,
        path: "/",
      });
    }
  }

  return res;
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
