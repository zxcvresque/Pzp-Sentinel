import path from "node:path";

export const MAX_TRANSACTION_ATTACHMENTS = 10;
export const MAX_TRANSACTION_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export interface StoredTransactionAttachment {
  id: string;
  originalName: string;
  contentType: string;
  size: number;
  uploaderId: string;
  uploadedAt: string;
}

export function transactionAttachmentRoot() {
  return path.join(process.cwd(), "data", "transaction-attachments");
}

export function transactionAttachmentDataPath(id: string) {
  return path.join(transactionAttachmentRoot(), `${id}.bin`);
}

export function transactionAttachmentMetaPath(id: string) {
  return path.join(transactionAttachmentRoot(), `${id}.json`);
}

export function safeAttachmentName(value: string) {
  return value.trim().replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 180) || "attachment";
}

export function transactionAttachmentUrl(id: string, originalName: string) {
  return `/api/attachments/${id}/${encodeURIComponent(originalName)}`;
}
