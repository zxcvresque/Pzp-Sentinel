import { readFile, writeFile } from "node:fs/promises";
import { InputFile } from "grammy";
import { bot } from "@/lib/bot";
import { escapeTelegramHtml } from "@/lib/telegram-format";
import {
  transactionAttachmentDataPath,
  transactionAttachmentIdFromUrl,
  transactionAttachmentMetaPath,
  type StoredTransactionAttachment,
} from "@/lib/transaction-attachments";

export interface AttachmentArchiveResult {
  url: string;
  archived: boolean;
  skipped?: boolean;
  error?: string;
}

async function saveMetadata(id: string, metadata: StoredTransactionAttachment) {
  await writeFile(transactionAttachmentMetaPath(id), JSON.stringify(metadata), "utf8");
}

/**
 * Archive locally stored transaction attachments into the dedicated Telegram
 * topic. Local storage remains the authenticated web source; Telegram is the
 * durable operations copy and its file/message IDs are persisted in metadata.
 */
export async function archiveTransactionAttachmentsToTelegram(transaction: {
  id: string;
  amount: unknown;
  currency: string;
  description: string;
  attachments: string[];
}): Promise<AttachmentArchiveResult[]> {
  const groupId = process.env.TG_GROUP_ID;
  // 548 is the production Attachments topic; the env value keeps deployments configurable.
  const topicId = process.env.TG_TOPIC_ATTACHMENTS || "548";
  const results: AttachmentArchiveResult[] = [];

  if (!groupId || !topicId) {
    return transaction.attachments.map((url) => ({
      url,
      archived: false,
      error: "Telegram attachments topic is not configured",
    }));
  }

  for (const url of transaction.attachments) {
    const id = transactionAttachmentIdFromUrl(url);
    if (!id) {
      results.push({ url, archived: true, skipped: true });
      continue;
    }

    let metadata: StoredTransactionAttachment;
    try {
      metadata = JSON.parse(await readFile(transactionAttachmentMetaPath(id), "utf8"));
    } catch (error) {
      results.push({ url, archived: false, error: `Attachment metadata unavailable: ${(error as Error).message}` });
      continue;
    }

    if (metadata.telegramFileId && metadata.telegramArchivedAt) {
      results.push({ url, archived: true, skipped: true });
      continue;
    }

    try {
      const symbol = transaction.currency === "INR" ? "₹" : "$";
      const caption = [
        `📎 <b>Transaction attachment</b>`,
        `<b>${escapeTelegramHtml(metadata.originalName)}</b>`,
        `${symbol}${escapeTelegramHtml(transaction.amount)} · ${escapeTelegramHtml(transaction.description.slice(0, 500))}`,
        `\n<code>${escapeTelegramHtml(transaction.id)}</code>`,
      ].join("\n");
      const sent = await bot.api.sendDocument(
        groupId,
        new InputFile(transactionAttachmentDataPath(id), metadata.originalName),
        {
          message_thread_id: Number(topicId),
          caption,
          parse_mode: "HTML",
        },
      );
      metadata = {
        ...metadata,
        transactionId: transaction.id,
        telegramFileId: sent.document.file_id,
        telegramMessageId: sent.message_id,
        telegramArchivedAt: new Date().toISOString(),
        telegramArchiveError: undefined,
      };
      await saveMetadata(id, metadata);
      results.push({ url, archived: true });
    } catch (error) {
      const message = (error as Error).message || "Telegram attachment archive failed";
      metadata = {
        ...metadata,
        transactionId: transaction.id,
        telegramArchiveError: message.slice(0, 1000),
      };
      await saveMetadata(id, metadata).catch(() => {});
      console.error(`[attachment-archive] ${transaction.id}/${id}:`, error);
      results.push({ url, archived: false, error: message });
    }
  }

  return results;
}
