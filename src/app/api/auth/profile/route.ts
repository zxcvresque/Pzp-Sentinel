import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!name || name.length > 100) {
    return NextResponse.json(
      { error: "Name must be between 1 and 100 characters" },
      { status: 400 },
    );
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { name },
  });

  return NextResponse.json({
    user: {
      id: updated.id,
      name: updated.name,
      telegramId: updated.telegramId,
      telegramUser: updated.telegramUser,
      photoUrl: updated.photoUrl,
      roles: updated.roles,
    },
  });
}
