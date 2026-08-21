import { prisma } from "@/lib/db";
import { Bot } from "grammy";
import type { InlineKeyboardMarkup } from "@grammyjs/types";
import type { NotifType } from "@/generated/prisma/enums";

// Lazy bot instance for sending DMs — avoids module-level throw
let _bot: Bot | null = null;
function getBot(): Bot | null {
  if (_bot) return _bot;
  const token = process.env.BOT_TOKEN;
  if (!token) return null;
  _bot = new Bot(token);
  return _bot;
}

export type { NotifType };

/**
 * Build a Telegram HTML message with blockquote heading, bold body, and optional details.
 */
export function formatTgMessage(heading: string, bodyBold: string, details?: string): string {
  let msg = `<blockquote><b>${heading}</b></blockquote>\n<b>${bodyBold}</b>`;
  if (details) msg += `\n${details}`;
  return msg;
}

/** Map a relative action path to a human-readable Mini App button label */
function deriveBtnLabel(actionUrl?: string): string {
  if (!actionUrl) return "Open Sentinel";
  if (actionUrl.includes("transaction")) return "View Transactions";
  if (actionUrl.includes("credential"))  return "View Credentials";
  if (actionUrl.includes("users"))       return "View Users";
  if (actionUrl.includes("task"))        return "My Tasks";
  if (actionUrl === "/profile")          return "Open Profile";
  if (actionUrl === "/donor")            return "My Donations";
  return "Open Sentinel";
}

/**
 * Unified notification: creates an in-app DB record and optionally sends a Telegram DM.
 *
 * - Always creates the Notification row.
 * - If the user has a chatId, sends a Telegram message (telegramMessage override or auto-generated from title+message).
 * - Telegram errors are swallowed so they never break the main flow.
 */
export async function notify(data: {
  userId: string;
  type: NotifType;
  title: string;
  message: string;
  entityId?: string;
  priority?: "LOW" | "NORMAL" | "HIGH";
  telegramMessage?: string;
  /** Custom Telegram buttons, used for private interactive notification flows. */
  telegramReplyMarkup?: InlineKeyboardMarkup;
  /** Relative path (e.g. "/admin/transactions") — becomes an inline Mini App button */
  actionUrl?: string;
  /** Override the button label (default: "Open Sentinel") */
  actionLabel?: string;
  /** Explicit per-resource channel decisions. These take precedence over global preferences and priority. */
  inAppOverride?: boolean;
  telegramOverride?: boolean;
}) {
  const {
    userId, type, title, message, entityId, priority = "NORMAL", telegramMessage,
    telegramReplyMarkup, actionUrl, actionLabel, inAppOverride, telegramOverride,
  } = data;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { chatId: true, dmPreferences: true, inAppPreferences: true },
  });
  const isHighPriority = priority === "HIGH";
  const shouldCreateInApp = inAppOverride ?? (user?.inAppPreferences.includes(type) || isHighPriority);
  const notification = shouldCreateInApp
    ? await prisma.notification.create({ data: { userId, type, title, message, entityId, priority } })
    : null;

  // Attempt Telegram DM and persist channel delivery state.
  try {
    const dmBot = getBot();
    const hasPref = user?.dmPreferences.includes(type);
    const shouldSendTelegram = telegramOverride ?? (hasPref || isHighPriority);

    // Explicit resource-level preferences can suppress even high-priority DMs.
    if (user?.chatId && dmBot && shouldSendTelegram) {
      if (notification) await prisma.notification.update({ where: { id: notification.id }, data: { telegramStatus: "SENDING", telegramAttempts: { increment: 1 }, telegramLastError: null } });
      const tgText = telegramMessage ?? formatTgMessage(title, message);
      const baseUrl = process.env.WEBAPP_URL || "https://pzp.finance";
      // Derive a readable label from the destination path if none given
      const btnLabel = actionLabel ?? deriveBtnLabel(actionUrl);
      // Use web_app so it opens inside the Mini App overlay, not the in-app browser
      const replyMarkup = telegramReplyMarkup ?? (actionUrl
        ? { inline_keyboard: [[{ text: btnLabel, web_app: { url: `${baseUrl}${actionUrl}` } }]] }
        : undefined);
      await dmBot.api.sendMessage(user.chatId, tgText, {
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      });
      if (notification) await prisma.notification.update({ where: { id: notification.id }, data: { telegramStatus: "SENT", telegramSentAt: new Date() } });
    } else if (!user?.chatId) {
      console.warn(`[notify] No chatId for user ${userId} — skipping TG DM`);
    } else if (!dmBot) {
      console.warn(`[notify] BOT_TOKEN not set — skipping TG DM`);
    } else {
      console.log(`[notify] User ${userId} has no pref for ${type} (non-high priority) — skipping DM`);
    }
  } catch (err: unknown) {
    const desc = typeof err === "object" && err !== null && "description" in err
      ? (err as { description?: string }).description ?? ""
      : "";
    // If the bot was blocked by the user (403), clear their chatId so the UI shows "Not linked"
    if (desc.includes("bot was blocked") || desc.includes("user is deactivated")) {
      try {
        await prisma.user.update({ where: { id: userId }, data: { chatId: null } });
      } catch {
        // ignore — best effort cleanup
      }
    }
    console.error(`[notify] TG DM failed for user ${userId}:`, err);
    if (notification) {
      await prisma.notification.update({
        where: { id: notification.id },
        data: { telegramStatus: "FAILED", telegramLastError: (err instanceof Error ? err.message : String(err)).slice(0, 1000) },
      }).catch(() => undefined);
    }
  }

  return notification;
}

/**
 * Notify all active admins. Failures for individual admins are isolated via Promise.allSettled.
 */
export async function notifyAdmins(data: Omit<Parameters<typeof notify>[0], "userId">) {
  const admins = await prisma.user.findMany({
    where: { roles: { has: "ADMIN" }, status: "ACTIVE" },
    select: { id: true },
  });
  await Promise.allSettled(admins.map((a) => notify({ ...data, userId: a.id })));
}
