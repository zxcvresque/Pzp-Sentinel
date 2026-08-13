import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  MAX_TRANSACTION_ATTACHMENT_BYTES,
  MAX_TRANSACTION_ATTACHMENTS,
  safeAttachmentName,
  transactionAttachmentDataPath,
  transactionAttachmentMetaPath,
  transactionAttachmentRoot,
  transactionAttachmentUrl,
  type StoredTransactionAttachment,
} from "@/lib/transaction-attachments";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const files = formData.getAll("files").filter((value): value is File => value instanceof File);

  if (!files.length) return NextResponse.json({ error: "Choose at least one file" }, { status: 400 });
  if (files.length > MAX_TRANSACTION_ATTACHMENTS) {
    return NextResponse.json({ error: `You can upload at most ${MAX_TRANSACTION_ATTACHMENTS} attachments` }, { status: 400 });
  }

  const oversized = files.find((file) => file.size > MAX_TRANSACTION_ATTACHMENT_BYTES);
  if (oversized) {
    return NextResponse.json({ error: `"${oversized.name}" exceeds the 20 MB limit` }, { status: 413 });
  }

  await mkdir(transactionAttachmentRoot(), { recursive: true });
  const stored: Array<{ url: string; name: string; size: number; type: string }> = [];

  for (const file of files) {
    const id = randomUUID();
    const originalName = safeAttachmentName(file.name);
    const metadata: StoredTransactionAttachment = {
      id,
      originalName,
      contentType: file.type || "application/octet-stream",
      size: file.size,
      uploaderId: user.id,
      uploadedAt: new Date().toISOString(),
    };

    try {
      await writeFile(transactionAttachmentDataPath(id), Buffer.from(await file.arrayBuffer()), { flag: "wx" });
      await writeFile(transactionAttachmentMetaPath(id), JSON.stringify(metadata), { encoding: "utf8", flag: "wx" });
    } catch (error) {
      await Promise.all([
        rm(transactionAttachmentDataPath(id), { force: true }),
        rm(transactionAttachmentMetaPath(id), { force: true }),
      ]);
      console.error("[attachments] Failed to persist upload", error);
      return NextResponse.json({ error: `Could not store "${originalName}"` }, { status: 500 });
    }

    stored.push({
      url: transactionAttachmentUrl(id, originalName),
      name: originalName,
      size: file.size,
      type: metadata.contentType,
    });
  }

  return NextResponse.json({ attachments: stored, urls: stored.map((item) => item.url) });
}
