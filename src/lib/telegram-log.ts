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

/**
 * Post a donation thank-you to the donations group. Uses TG_DONATION_GROUP_ID
 * (+ optional TG_DONATION_TOPIC_ID for a specific topic; omit for General), and
 * falls back to the logs group's General topic for testing when unset.
 */
export async function postDonationThanks(text: string) {
  const groupId = process.env.TG_DONATION_GROUP_ID || GROUP_ID;
  if (!groupId) return;
  const topicId = process.env.TG_DONATION_TOPIC_ID;
  try {
    await bot.api.sendMessage(groupId, text, {
      parse_mode: "HTML",
      ...(topicId ? { message_thread_id: parseInt(topicId) } : {}),
    });
  } catch {
    // TG delivery failed — non-blocking
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
  CREATED: "🆕",
  UPDATED: "✏️",
  DELETED: "🗑️",
  PROPOSED: "📝",
  SHARE: "🤝",
  GRANT: "🔓",
  REVOKE: "⛔",
  REQUEST: "🙋",
  DEV_REVEAL: "👁️",
  ADMIN_REVEAL: "👁️",
  VPS_LINK: "🔗",
  VPS_UNLINK: "✂️",
  SUBSCRIPTION_CREATE: "💳",
  SUBSCRIPTION_UPDATE: "🔄",
  REMINDER_CREATE: "⏰",
  REMINDER_UPDATE: "🔔",
  SERVICE_CREATE: "🛠️",
  SERVICE_UPDATE: "⚙️",
  RAZORPAY_CAPTURED: "💳",
  RAZORPAY_INVITE_CREATE: "🔗",
  RAZORPAY_INVITE_REVOKE: "⛔",
  PAYMENT_INVITE_CREATE: "🔗",
  PAYMENT_INVITE_CLAIM: "✅",
  PAYMENT_INVITE_REVOKE: "⛔",
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

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function logTransactionMutation(tx: {
  action: "UPDATED" | "DELETED";
  id: string;
  actorName: string;
  amount: unknown;
  currency: string;
  direction: string;
  description: string;
  changes?: string[];
}) {
  const symbol = tx.currency === "INR" ? "₹" : "$";
  const lines = [
    `${tx.action === "DELETED" ? "🗑️" : "✏️"} <b>Transaction ${tx.action}</b>`,
    `<b>${symbol}${escapeHtml(tx.amount)}</b> · ${escapeHtml(tx.direction)}`,
    escapeHtml(tx.description),
    `👤 By: ${escapeHtml(tx.actorName)}`,
    ...(tx.changes || []).map((change) => `• ${escapeHtml(change)}`),
    `<code>${escapeHtml(tx.id)}</code>`,
  ];
  return sendToTopic("transactions", lines.join("\n"));
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

