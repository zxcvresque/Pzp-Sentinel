/**
 * GitHub Logs — Immutable audit trail via git commits
 *
 * Each log category is a separate JSONL file in the Sentinel-Logs repo.
 * Every log entry = a commit, so git history = full version history.
 * Repo: https://github.com/zxcvresque/Sentinel-Logs
 */

import { logAuditEvent } from "./telegram-log";

const GITHUB_TOKEN = process.env.GITHUB_LOGS_TOKEN!;
const REPO_OWNER = "zxcvresque";
const REPO_NAME = "Sentinel-Logs";
const BRANCH = "main";

const API_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents`;

type LogCategory =
  | "audit"
  | "transactions"
  | "approvals"
  | "credentials"
  | "subscriptions"
  | "users"
  | "bot-events"
  | "reminders";

interface LogEntry {
  timestamp: string;
  action: string;
  userId?: string;
  userName?: string;
  entityType?: string;
  entityId?: string;
  details?: string;
  meta?: Record<string, unknown>;
}

/**
 * Append a log entry to a category file in the Sentinel-Logs repo.
 * Each call = one git commit = one immutable history entry.
 */
export async function githubLog(
  category: LogCategory,
  entry: Omit<LogEntry, "timestamp">,
  commitMessage?: string,
): Promise<boolean> {
  if (!GITHUB_TOKEN) {
    console.warn("[github-log] GITHUB_LOGS_TOKEN not set, skipping log");
    return false;
  }

  const filePath = `${category}.jsonl`;
  const logEntry: LogEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  const newLine = JSON.stringify(logEntry);
  const message =
    commitMessage ||
    `[${category}] ${entry.action}${entry.entityType ? ` — ${entry.entityType}` : ""}${entry.entityId ? ` ${entry.entityId.slice(0, 8)}` : ""}`;

  const MAX_RETRIES = 4;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Get current file (to get its SHA for updates)
      let existingContent = "";
      let sha: string | undefined;

      const getRes = await fetch(`${API_BASE}/${filePath}?ref=${BRANCH}`, {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (getRes.ok) {
        const data = await getRes.json();
        sha = data.sha;
        existingContent = Buffer.from(data.content, "base64").toString("utf-8");
      } else if (getRes.status !== 404) {
        console.error("[github-log] Failed to read file:", getRes.status);
        return false;
      }
      // 404 = file doesn't exist yet, we'll create it

      // Append new line
      const updatedContent = existingContent
        ? existingContent.trimEnd() + "\n" + newLine + "\n"
        : newLine + "\n";

      // Commit the update
      const putRes = await fetch(`${API_BASE}/${filePath}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          content: Buffer.from(updatedContent).toString("base64"),
          sha,
          branch: BRANCH,
        }),
      });

      if (putRes.ok) return true;

      // 409 = SHA mismatch (concurrent write) — retry with fresh SHA
      if (putRes.status === 409 && attempt < MAX_RETRIES - 1) {
        const jitter = Math.random() * 500;
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1) + jitter));
        continue;
      }

      const err = await putRes.text();
      console.error("[github-log] Commit failed:", putRes.status, err);
      return false;
    } catch (err) {
      console.error("[github-log] Error:", err);
      return false;
    }
  }

  return false;
}

/**
 * Log a financial transaction (donation, expense, subscription payment)
 */
export function logTransaction(data: {
  action: string;
  userId: string;
  userName: string;
  amount: string;
  currency: string;
  direction: string;
  method?: string;
  entityId: string;
  details?: string;
}) {
  return githubLog("transactions", {
    action: data.action,
    userId: data.userId,
    userName: data.userName,
    entityType: "Transaction",
    entityId: data.entityId,
    details: data.details,
    meta: {
      amount: data.amount,
      currency: data.currency,
      direction: data.direction,
      method: data.method,
    },
  });
}

/**
 * Log an approval/rejection action
 */
export function logApproval(data: {
  action: "APPROVE" | "REJECT";
  reviewerId: string;
  reviewerName: string;
  entityType: string;
  entityId: string;
  note?: string;
}) {
  return githubLog("approvals", {
    action: data.action,
    userId: data.reviewerId,
    userName: data.reviewerName,
    entityType: data.entityType,
    entityId: data.entityId,
    details: data.note,
  });
}

/**
 * Log a user management action
 */
export function logUserAction(data: {
  action: string;
  adminId: string;
  adminName: string;
  targetUserId: string;
  targetUserName: string;
  details?: string;
}) {
  return githubLog("users", {
    action: data.action,
    userId: data.adminId,
    userName: data.adminName,
    entityType: "User",
    entityId: data.targetUserId,
    details: `${data.targetUserName}: ${data.details || data.action}`,
  });
}

/**
 * Log a credential vault action.
 * Writes to the immutable GitHub log AND mirrors to the Telegram audit topic.
 * Never logs the secret value — only action, platform, and entity id.
 */
export function logCredentialAction(data: {
  action: string;
  userId: string;
  userName: string;
  entityId: string;
  platform: string;
  details?: string;
}) {
  // Mirror to the Telegram audit topic (fire-and-forget; swallows its own errors).
  logAuditEvent({
    action: data.action,
    entityType: "Credential",
    entityId: data.entityId,
    userName: data.userName,
    details: [data.platform, data.details].filter(Boolean).join(" — "),
  });
  return githubLog("credentials", {
    action: data.action,
    userId: data.userId,
    userName: data.userName,
    entityType: "Credential",
    entityId: data.entityId,
    details: data.details,
    meta: { platform: data.platform },
  });
}

/**
 * Log a bot event
 */
export function logBotEvent(data: {
  action: string;
  userId?: string;
  userName?: string;
  details?: string;
}) {
  return githubLog("bot-events", {
    action: data.action,
    userId: data.userId,
    userName: data.userName,
    details: data.details,
  });
}

/**
 * Log a subscription action (create, update, delete, renew)
 */
export function logSubscriptionAction(data: {
  action: string;
  userId: string;
  userName: string;
  entityId: string;
  platform: string;
  details?: string;
  meta?: Record<string, unknown>;
}) {
  return githubLog("subscriptions", {
    action: data.action,
    userId: data.userId,
    userName: data.userName,
    entityType: "Subscription",
    entityId: data.entityId,
    details: data.details,
    meta: { platform: data.platform, ...data.meta },
  });
}

/**
 * Log a reminder action (create, update, delete)
 */
export function logReminderAction(data: {
  action: string;
  userId: string;
  userName: string;
  entityId: string;
  details?: string;
}) {
  return githubLog("reminders", {
    action: data.action,
    userId: data.userId,
    userName: data.userName,
    entityType: "Reminder",
    entityId: data.entityId,
    details: data.details,
  });
}

/**
 * General audit log — catch-all for anything not covered above
 */
export function logAudit(data: {
  action: string;
  userId: string;
  userName: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  details?: string;
}) {
  return githubLog("audit", {
    action: data.action,
    userId: data.userId,
    userName: data.userName,
    entityType: data.entityType,
    entityId: data.entityId,
    details: data.details,
    meta: {
      ...(data.before && { before: data.before }),
      ...(data.after && { after: data.after }),
    },
  });
}
