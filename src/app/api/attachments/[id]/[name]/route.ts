import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  transactionAttachmentDataPath,
  transactionAttachmentMetaPath,
  transactionAttachmentUrl,
  type StoredTransactionAttachment,
} from "@/lib/transaction-attachments";

export const runtime = "nodejs";

const ATTACHMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, name } = await params;
  if (!ATTACHMENT_ID.test(id)) return new NextResponse(null, { status: 404 });

  try {
    const metadata = JSON.parse(await readFile(transactionAttachmentMetaPath(id), "utf8")) as StoredTransactionAttachment;
    if (metadata.id !== id || metadata.originalName !== name) return new NextResponse(null, { status: 404 });

    const url = transactionAttachmentUrl(id, metadata.originalName);
    const transaction = await prisma.transaction.findFirst({
      where: { attachments: { has: url } },
      select: { fromUserId: true, createdById: true },
    });
    const allowed = hasRole(user.roles, "ADMIN")
      || metadata.uploaderId === user.id
      || transaction?.fromUserId === user.id
      || transaction?.createdById === user.id;
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const filePath = transactionAttachmentDataPath(id);
    const fileStat = await stat(filePath);
    const canInline = metadata.contentType.startsWith("image/") || metadata.contentType === "application/pdf";
    const encodedName = encodeURIComponent(metadata.originalName);
    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>;

    return new NextResponse(stream, {
      headers: {
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Content-Length": String(fileStat.size),
        "Content-Disposition": `${canInline ? "inline" : "attachment"}; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
