import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fetchTelegramFile } from "@/lib/telegram-file";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse(null, { status: 401 });
  const { fileId } = await params;
  const urls = [`/api/proof/${fileId}`, `/api/proof/${encodeURIComponent(fileId)}`];
  const authorised = await prisma.transaction.count({
    where: {
      attachments: { hasSome: urls },
      ...(hasRole(user.roles, "ADMIN")
        ? {}
        : { OR: [{ fromUserId: user.id }, { createdById: user.id }] }),
    },
  });
  if (!authorised) return new NextResponse(null, { status: 403 });
  const file = await fetchTelegramFile(fileId);
  if (!file) return new NextResponse(null, { status: 404 });
  return new NextResponse(file.body, {
    headers: { "Content-Type": file.contentType, "Cache-Control": "private, no-store" },
  });
}
