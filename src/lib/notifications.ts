import { prisma } from "@/lib/db";
import { Bot } from "grammy";
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
}) {
  const { userId, type, title, message, entityId, priority = "NORMAL", telegramMessage } = data;

  // 1. Create in-app notification
  const notification = await prisma.notification.create({
    data: { userId, type, title, message, entityId, priority },
  });

  // 2. Attempt Telegram DM
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { chatId: true, dmPreferences: true },
    });

    const dmBot = getBot();
    if (user?.chatId && dmBot && user.dmPreferences.includes(type)) {
      const tgText = telegramMessage ?? formatTgMessage(title, message);
      await dmBot.api.sendMessage(user.chatId, tgText, { parse_mode: "HTML" });
    }
  } catch (err: unknown) {
    // If the bot was blocked by the user (403), clear their chatId so the UI shows "Not linked"
    const desc = typeof err === "object" && err !== null && "description" in err
      ? (err as { description?: string }).description ?? ""
      : "";
    if (desc.includes("bot was blocked") || desc.includes("user is deactivated")) {
      try {
        await prisma.user.update({ where: { id: userId }, data: { chatId: null } });
      } catch {
        // ignore — best effort cleanup
      }
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
