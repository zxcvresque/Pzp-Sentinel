import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
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

async function cleanAbandonedDrafts() {
  const drafts = await prisma.document.findMany({
    where: { status: "DRAFT", createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    select: { id: true, url: true },
    take: 100,
  });
  for (const draft of drafts) {
    const storageId = draft.url.split("/")[3];
    if (/^[0-9a-f-]{36}$/i.test(storageId || "")) {
      await Promise.all([
        rm(transactionAttachmentDataPath(storageId), { force: true }),
        rm(transactionAttachmentMetaPath(storageId), { force: true }),
      ]);
    }
  }
  if (drafts.length) await prisma.document.deleteMany({ where: { id: { in: drafts.map((draft) => draft.id) }, status: "DRAFT" } });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await cleanAbandonedDrafts().catch((error) => console.error("[attachments] Draft cleanup failed", error));

  const formData = await req.formData();
  const requestedKind = String(formData.get("kind") || "RECEIPT").toUpperCase();
  const kind = ["RECEIPT", "INVOICE", "CONTRACT", "LICENCE", "PROOF", "OTHER"].includes(requestedKind)
    ? requestedKind as "RECEIPT" | "INVOICE" | "CONTRACT" | "LICENCE" | "PROOF" | "OTHER"
    : "OTHER";
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

    const url = transactionAttachmentUrl(id, originalName);
    try {
      await writeFile(transactionAttachmentDataPath(id), Buffer.from(await file.arrayBuffer()), { flag: "wx" });
      await writeFile(transactionAttachmentMetaPath(id), JSON.stringify(metadata), { encoding: "utf8", flag: "wx" });
      await prisma.document.create({
        data: {
          url,
          originalName,
          contentType: metadata.contentType,
          size: file.size,
          kind,
          uploaderId: user.id,
        },
      });
    } catch (error) {
      await Promise.all([
        rm(transactionAttachmentDataPath(id), { force: true }),
        rm(transactionAttachmentMetaPath(id), { force: true }),
      ]);
      console.error("[attachments] Failed to persist upload", error);
      return NextResponse.json({ error: `Could not store "${originalName}"` }, { status: 500 });
    }

    stored.push({
      url,
      name: originalName,
      size: file.size,
      type: metadata.contentType,
    });
  }

  return NextResponse.json({ attachments: stored, urls: stored.map((item) => item.url) });
}
