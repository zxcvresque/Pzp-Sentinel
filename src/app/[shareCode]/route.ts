import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { SHARE_CODE_PATTERN, shareBaseUrl, shareBotUrl } from "@/lib/share-links";

export async function GET(req: NextRequest, { params }: { params: Promise<{ shareCode: string }> }) {
  const { shareCode } = await params;
  if (!SHARE_CODE_PATTERN.test(shareCode)) return NextResponse.redirect(new URL("/", req.url));
  const shareLink = await prisma.shareLink.findUnique({ where: { code: shareCode }, select: { id: true, targetPath: true } });
  if (!shareLink) return NextResponse.redirect(new URL("/", req.url));

  await prisma.shareLink.update({ where: { id: shareLink.id }, data: { openCount: { increment: 1 }, lastOpenedAt: new Date() } }).catch(() => undefined);
  const openMode = req.nextUrl.searchParams.get("open");
  if (openMode === "website" || openMode === "webapp") {
    return NextResponse.redirect(new URL(shareLink.targetPath, shareBaseUrl(req.nextUrl.origin)));
  }
  return NextResponse.redirect(shareBotUrl(shareCode));
}
