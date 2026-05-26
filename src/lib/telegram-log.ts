import { bot } from "./bot";

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

// ─── Audit action → emoji map ───
const auditEmoji: Record<string, string> = {
  CREATE: "🆕",
  UPDATE: "✏️",
  DELETE: "🗑️",
  APPROVE: "✅",
  REJECT: "❌",
  BOT_REGISTER: "🤖",
  WEB_LOGIN: "🔑",
  ROLE_CHANGE: "🏷️",
  CREDENTIAL_CREATE: "🔐",
  CREDENTIAL_UPDATE: "🔏",
  CREDENTIAL_REVIEW: "📋",
  SUBSCRIPTION_CREATE: "💳",
  SUBSCRIPTION_UPDATE: "🔄",
  REMINDER_CREATE: "⏰",
  REMINDER_UPDATE: "🔔",
  SERVICE_CREATE: "🛠️",
  SERVICE_UPDATE: "⚙️",
};

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
  const arrow = tx.direction === "IN" ? "💰" : "💸";
  const symbol = tx.currency === "INR" ? "₹" : "$";
  const lines = [
    `${arrow} <b>New Transaction</b>`,
    `<b>${symbol}${tx.amount}</b> · ${tx.method} · ${tx.type}`,
    tx.description,
    `Status: <b>${tx.status}</b>`,
    tx.fromUserName ? `👤 From: ${tx.fromUserName}` : null,
    tx.createdByName ? `🖊️ By: ${tx.createdByName}` : null,
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
  const icon = tx.status === "APPROVED" ? "✅" : "🚫";
  const symbol = tx.currency === "INR" ? "₹" : "$";
  const lines = [
    `${icon} <b>Transaction ${tx.status}</b>`,
    `<b>${symbol}${tx.amount}</b> — ${tx.description}`,
    `👁️ Reviewed by: ${tx.reviewerName}`,
    tx.reason ? `💬 Reason: ${tx.reason}` : null,
    `<code>${tx.id}</code>`,
  ];
  return sendToTopic("transactions", lines.filter(Boolean).join("\n"));
}

/** Replace "IN INR 500" / "OUT USD 20" with emoji + symbol in audit details */
function formatAuditDetails(details: string): string {
  return details
    .replace(/\bIN\s+(INR)\s+/g, "💰 ₹")
    .replace(/\bIN\s+(USD)\s+/g, "💰 $")
    .replace(/\bOUT\s+(INR)\s+/g, "💸 ₹")
    .replace(/\bOUT\s+(USD)\s+/g, "💸 $");
}

export function logAuditEvent(entry: {
  action: string;
  entityType: string;
  entityId: string;
  userName: string;
  details?: string;
}) {
  const emoji = auditEmoji[entry.action] || "📝";
  const lines = [
    `${emoji} <b>${entry.action}</b> · ${entry.entityType}`,
    `👤 By: ${entry.userName}`,
    entry.details ? formatAuditDetails(entry.details) : null,
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
    `🎉 <b>New User Registered</b>`,
    `👤 ${user.name} (@${user.telegramUser})`,
    `🏷️ Roles: ${user.roles.join(", ")}`,
    `🖊️ Added by: ${user.createdByName}`,
  ];
  return sendToTopic("audit", lines.join("\n"));
}

export function logProofScreenshot(txId: string, fileId: string, description: string) {
  return sendPhotoToTopic(
    "screenshots",
    fileId,
    `🧾 Proof for: ${description}\n<code>${txId}</code>`
  );
}

/**
 * Send proof screenshots to the screenshots topic with full transaction context.
 * `urls` are proxy URLs like /api/avatar/{fileId} — extracts the file_id and
 * re-sends the photo with a proper caption containing tx details.
 */
export async function logProofScreenshots(tx: {
  id: string;
  amount: unknown;
  currency: string;
  description: string;
  userName: string;
  attachments: string[];
}) {
  const symbol = tx.currency === "INR" ? "₹" : "$";
  const caption =
    `🧾 <b>Proof: ${tx.description}</b>\n` +
    `<b>${symbol}${tx.amount}</b> · ${tx.userName}\n` +
    `<code>${tx.id}</code>`;

  for (const url of tx.attachments) {
    const match = url.match(/\/api\/avatar\/(.+)$/);
    if (match) {
      await sendPhotoToTopic("screenshots", match[1], caption);
    }
  }
}

