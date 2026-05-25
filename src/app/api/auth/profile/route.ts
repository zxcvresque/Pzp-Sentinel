import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();

    const data: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 100) {
        return NextResponse.json(
          { error: "Name must be between 1 and 100 characters" },
          { status: 400 },
        );
      }
      data.name = name;
    }

    if (body.themeColor !== undefined) {
      const themeColor = typeof body.themeColor === "string" ? body.themeColor.trim() : "";
      if (!/^#[0-9a-fA-F]{6}$/.test(themeColor)) {
        return NextResponse.json(
          { error: `Invalid hex color: "${themeColor}"` },
          { status: 400 },
        );
      }
      data.themeColor = themeColor;
    }

    if (body.savedColors !== undefined) {
      if (!Array.isArray(body.savedColors) || body.savedColors.length > 3) {
        return NextResponse.json(
          { error: "savedColors must be an array of up to 3 hex colors" },
          { status: 400 },
        );
      }
      const colors = body.savedColors.filter(
        (c: unknown) => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c)
      );
      data.savedColors = colors;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 },
      );
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
    });

    return NextResponse.json({
      user: {
        id: updated.id,
        name: updated.name,
        telegramId: updated.telegramId,
        telegramUser: updated.telegramUser,
        photoUrl: updated.photoUrl,
        themeColor: updated.themeColor,
        savedColors: updated.savedColors,
        chatId: updated.chatId,
        roles: updated.roles,
        createdAt: updated.createdAt.toISOString(),
      },
    });
  } catch (e) {
    console.error("Profile PATCH error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 },
    );
  }
}
