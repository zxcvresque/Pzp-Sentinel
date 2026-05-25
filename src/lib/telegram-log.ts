import { bot } from "./bot";
import { InputFile } from "grammy";
import { readFile } from "fs/promises";
import { join } from "path";

const GROUP_ID = process.env.TG_GROUP_ID;
const TOPIC_AUDIT = process.env.TG_TOPIC_AUDIT;
const TOPIC_TRANSACTIONS = process.env.TG_TOPIC_TRANSACTIONS;
const TOPIC_SCREENSHOTS = process.env.TG_TOPIC_SCREENSHOTS;

type Topic = "audit" | "transactions" | "screenshots";

const topicMap: Record<Topic, string | undefined> = {
  audit: TOPIC_AUDIT,
  transactions: TOPIC_TRANSACTIONS,
  screenshots: TOPIC_SCREENSHOTS,
};

async function sendToTopic(topic: Topic, text: string) {
  if (!GROUP_ID) return;
  const threadId = topicMap[topic];
  if (!threadId) return;

  try {
    await bot.api.sendMessage(GROUP_ID, text, {
      message_thread_id: parseInt(threadId),
      parse_mode: "HTML",
    });
  } catch {
    // TG delivery failed — non-blocking, data is still in DB
  }
}

async function sendPhotoToTopic(topic: Topic, fileId: string, caption: string) {
  if (!GROUP_ID) return;
  const threadId = topicMap[topic];
  if (!threadId) return;

  try {
    await bot.api.sendPhoto(GROUP_ID, fileId, {
      message_thread_id: parseInt(threadId),
      caption,
      parse_mode: "HTML",
    });
  } catch {
    // TG delivery failed
  }
}

/**
 * Send a locally-stored image file to a TG topic.
 * `localUrl` is a path like `/uploads/receipts/abc.jpg` — resolved from `public/`.
 */
async function sendLocalPhotoToTopic(topic: Topic, localUrl: string, caption: string) {
  if (!GROUP_ID) return;
  const threadId = topicMap[topic];
  if (!threadId) return;

  try {
    const filePath = join(process.cwd(), "public", localUrl);
    const buffer = await readFile(filePath);
    const filename = localUrl.split("/").pop() || "receipt.jpg";
    await bot.api.sendPhoto(GROUP_ID, new InputFile(buffer, filename), {
      message_thread_id: parseInt(threadId),
      caption,
      parse_mode: "HTML",
    });
  } catch {
    // TG delivery failed — non-blocking
  }
}

export function logTransaction(tx: {
  id: string;
  amount: unknown;
  currency: string;
  method: string;
  direction: string;
  type: string;
  description: string;
  status: string;
  fromUserName?: string;
  createdByName?: string;
}) {
  const arrow = tx.direction === "IN" ? "📥" : "📤";
  const symbol = tx.currency === "INR" ? "₹" : "$";
  const lines = [
    `${arrow} <b>New Transaction</b>`,
    `<b>${symbol}${tx.amount}</b> · ${tx.method} · ${tx.type}`,
    tx.description,
    `Status: <b>${tx.status}</b>`,
    tx.fromUserName ? `From: ${tx.fromUserName}` : null,
    tx.createdByName ? `By: ${tx.createdByName}` : null,
    `<code>${tx.id}</code>`,
  ];
  return sendToTopic("transactions", lines.filter(Boolean).join("\n"));
}

export function logTransactionReview(tx: {
  id: string;
  amount: unknown;
  currency: string;
  description: string;
  status: string;
  reviewerName: string;
  reason?: string | null;
}) {
  const icon = tx.status === "APPROVED" ? "✅" : "❌";
  const symbol = tx.currency === "INR" ? "₹" : "$";
  const lines = [
    `${icon} <b>Transaction ${tx.status}</b>`,
    `<b>${symbol}${tx.amount}</b> — ${tx.description}`,
    `Reviewed by: ${tx.reviewerName}`,
    tx.reason ? `Reason: ${tx.reason}` : null,
    `<code>${tx.id}</code>`,
  ];
  return sendToTopic("transactions", lines.filter(Boolean).join("\n"));
}

export function logAuditEvent(entry: {
  action: string;
  entityType: string;
  entityId: string;
  userName: string;
  details?: string;
}) {
  const lines = [
    `🔍 <b>${entry.action}</b> · ${entry.entityType}`,
    `By: ${entry.userName}`,
    entry.details || null,
    `<code>${entry.entityId}</code>`,
  ];
  return sendToTopic("audit", lines.filter(Boolean).join("\n"));
}

export function logUserCreated(user: {
  name: string;
  telegramUser: string;
  roles: string[];
  createdByName: string;
}) {
  const lines = [
    `👤 <b>New User</b>`,
    `${user.name} (@${user.telegramUser})`,
    `Roles: ${user.roles.join(", ")}`,
    `Added by: ${user.createdByName}`,
  ];
  return sendToTopic("audit", lines.join("\n"));
}

export function logProofScreenshot(txId: string, fileId: string, description: string) {
  return sendPhotoToTopic(
    "screenshots",
    fileId,
    `📎 Proof for: ${description}\n<code>${txId}</code>`
  );
}

/**
 * Send locally-uploaded receipt photos to the screenshots topic.
 * `urls` are relative paths like `/uploads/receipts/abc.jpg`.
 */
export async function logReceiptPhotos(txId: string, description: string, urls: string[]) {
  for (const url of urls) {
    await sendLocalPhotoToTopic(
      "screenshots",
      url,
      `📎 Receipt for: ${description}\n<code>${txId}</code>`
    );
  }
}
