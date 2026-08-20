import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { fetchTelegramFile } from "@/lib/telegram-file";

/**
 * GET /api/avatar/[fileId]
 *
 * Proxies a Telegram file by its file_id.
 * 1. Calls getFile to resolve the temporary download URL
 * 2. Streams the bytes back with a 7-day cache header
 *
 * This lets us store TG file_ids in the DB while serving images
 * through normal <img src=""> tags without exposing the bot token.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { fileId } = await params;
  if (!process.env.BOT_TOKEN || !fileId) {
    return NextResponse.json({ error: "Missing config" }, { status: 500 });
  }

  try {
    const rawUrl = `/api/avatar/${fileId}`;
    const encodedUrl = `/api/avatar/${encodeURIComponent(fileId)}`;
    const isAvatar = await prisma.user.count({ where: { photoUrl: { in: [rawUrl, encodedUrl] } } });

    // Legacy proof/key URLs used this route. Keep them private while existing
    // records are migrated to /api/proof and /api/vps-key.
    if (!isAvatar) {
      const user = await getCurrentUser();
      if (!user) return new NextResponse(null, { status: 401 });
      const isAdmin = hasRole(user.roles, "ADMIN");
      const ownsProof = isAdmin ? true : Boolean(await prisma.transaction.count({
        where: {
          OR: [{ fromUserId: user.id }, { createdById: user.id }],
          attachments: { hasSome: [rawUrl, encodedUrl] },
        },
      }));
      if (!ownsProof) return new NextResponse(null, { status: 403 });
    }

    const file = await fetchTelegramFile(fileId);
    if (!file) return new NextResponse(null, { status: 404 });

    return new NextResponse(file.body, {
      headers: {
        "Content-Type": file.contentType,
        "Cache-Control": isAvatar
          ? "public, max-age=2592000, immutable"
          : "private, no-store",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
