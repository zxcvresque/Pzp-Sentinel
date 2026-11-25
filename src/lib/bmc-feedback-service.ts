import { Bot } from "grammy";
import type { PrismaClient } from "@/generated/prisma/client";
import { escapeTelegramHtml } from "./telegram-format";
import { FeedbackError, feedbackAnswers, feedbackText, fullBmcResponse, formatBmcFeedbackReceipt } from "./bmc-feedback-response";

export async function saveBmcFeedback(db: PrismaClient, input: {
  id: string; userId: string; source: "APP" | "TELEGRAM";
  body: Record<string, unknown>;
}) {
  return db.$transaction(async (tx) => {
    const feedback = await tx.bmcSubscriptionFeedback.findUnique({ where: { id: input.id }, include: { user: true } });
    if (!feedback || feedback.userId !== input.userId) throw new FeedbackError("Response request not found.", 404);
    const addition = Object.hasOwn(input.body, "additionalInfo");
    const data = addition
      ? { additionalInfo: feedbackText(input.body.additionalInfo), additionalInfoAt: new Date(), responseSource: input.source }
      : { ...feedbackAnswers(input.body), stage: "COMPLETED" as const, respondedAt: new Date(), responseSource: input.source };
    if (addition && feedback.stage !== "COMPLETED") throw new FeedbackError("Submit the original response first.", 409);
    const changed = await tx.bmcSubscriptionFeedback.updateMany({
      where: {
        id: input.id, userId: input.userId,
        ...(addition ? { stage: "COMPLETED", additionalInfoAt: null } : { stage: { not: "COMPLETED" }, respondedAt: null }),
      },
      data: { ...data, responseRevision: { increment: 1 }, telegramSyncError: null },
    });
    if (changed.count !== 1) throw new FeedbackError(addition ? "Additional information has already been added. Each form allows one addition." : "This form has already been submitted.", 409);
    const saved = await tx.bmcSubscriptionFeedback.findUniqueOrThrow({ where: { id: input.id } });
    const title = addition ? "Donor added information about BMC recurring support" : "Donor replied about BMC recurring support";
    // Persist admin notifications and the response together. A bot outage cannot
    // lose the notification, and concurrent submissions cannot notify twice.
    const admins = await tx.user.findMany({ where: { roles: { has: "ADMIN" }, status: "ACTIVE" }, select: { id: true } });
    if (admins.length) await tx.notification.createMany({ data: admins.map(admin => ({
      userId: admin.id, type: "SYSTEM" as const, title,
      message: `${feedback.user.name}\n\n${fullBmcResponse(saved)}`,
      entityId: saved.id, actionUrl: `/notifications/feedback/${saved.id}`,
      priority: "HIGH", telegramStatus: "PENDING_FEEDBACK",
    })) });
    await tx.auditLog.create({ data: {
      userId: input.userId, action: addition ? "BMC_SUBSCRIPTION_FEEDBACK_ADDED" : "BMC_SUBSCRIPTION_FEEDBACK",
      entityType: "BmcSubscriptionFeedback", entityId: input.id,
      after: { source: input.source, revision: saved.responseRevision, ...data },
    } });
    return saved;
  });
}

export async function syncBmcFeedbackMessage(db: PrismaClient, id: string, bot: Bot) {
  const feedback = await db.bmcSubscriptionFeedback.findUnique({ where: { id }, include: { user: true } });
  if (!feedback || feedback.stage !== "COMPLETED" || feedback.telegramSyncedRevision >= feedback.responseRevision) return;
  const chatId = feedback.telegramChatId || feedback.user.chatId;
  if (!chatId) return;
  const claimedAt = new Date();
  const claimed = await db.bmcSubscriptionFeedback.updateMany({ where: {
    id, responseRevision: feedback.responseRevision,
    telegramSyncedRevision: { lt: feedback.responseRevision },
    OR: [{ telegramSyncClaimedAt: null }, { telegramSyncClaimedAt: { lt: new Date(Date.now() - 120_000) } }],
  }, data: { telegramSyncClaimedAt: claimedAt } });
  if (!claimed.count) return;
  const appUrl = new URL(`/notifications/feedback/${feedback.id}`, process.env.WEBAPP_URL || "https://sentinel.piratezparty.com").toString();
  const text = formatBmcFeedbackReceipt(feedback);
  const options = {
    parse_mode: "HTML" as const,
    reply_markup: { inline_keyboard: feedback.additionalInfoAt ? [] : [[{ text: "Add additional info?", web_app: { url: appUrl } }]] },
  };
  try {
    let messageId = feedback.telegramMessageId;
    if (messageId) {
      try { await bot.api.editMessageText(chatId, messageId, text, options); }
      catch (error) {
        if (!/message is not modified/i.test(String(error))) throw error;
      }
    } else {
      // Historic prompts predate message-ID tracking. Telegram cannot look up
      // their IDs; create one tracked receipt and edit it on subsequent updates.
      const message = await bot.api.sendMessage(chatId, text, options);
      messageId = message.message_id;
      // Save the identity even if a new form revision was submitted during send.
      await db.bmcSubscriptionFeedback.updateMany({ where: { id, telegramMessageId: null }, data: { telegramChatId: chatId, telegramMessageId: messageId } });
    }
    await db.bmcSubscriptionFeedback.updateMany({ where: { id, responseRevision: feedback.responseRevision }, data: {
      telegramChatId: chatId, telegramMessageId: messageId, telegramSyncedRevision: feedback.responseRevision, telegramSyncError: null,
    } });
  } catch {
    await db.bmcSubscriptionFeedback.update({ where: { id }, data: { telegramSyncError: "Telegram update pending; the bot will retry." } });
  } finally {
    await db.bmcSubscriptionFeedback.updateMany({ where: { id, telegramSyncClaimedAt: claimedAt }, data: { telegramSyncClaimedAt: null } });
  }
}

let draining = false;
export async function drainBmcFeedbackDelivery(db: PrismaClient, botInstance?: Bot) {
  if (draining) return;
  const token = process.env.BOT_TOKEN;
  if (!botInstance && !token) return;
  draining = true;
  const bot = botInstance || new Bot(token!);
  try {
    const pending = await db.bmcSubscriptionFeedback.findMany({ where: {
      stage: "COMPLETED", responseRevision: { gt: db.bmcSubscriptionFeedback.fields.telegramSyncedRevision },
      AND: [
        { OR: [{ telegramChatId: { not: null } }, { user: { chatId: { not: null } } }] },
        { OR: [{ telegramSyncClaimedAt: null }, { telegramSyncClaimedAt: { lt: new Date(Date.now() - 120_000) } }] },
      ],
    }, select: { id: true }, orderBy: { updatedAt: "asc" }, take: 20 });
    for (const item of pending) await syncBmcFeedbackMessage(db, item.id, bot);
    const notifications = await db.notification.findMany({ where: { telegramStatus: "PENDING_FEEDBACK" }, include: { user: { select: { chatId: true } } }, take: 20, orderBy: { createdAt: "asc" } });
    for (const notification of notifications) {
      if (!notification.user.chatId) {
        await db.notification.update({ where: { id: notification.id }, data: { telegramStatus: "SKIPPED_NO_CHAT" } });
        continue;
      }
      // Claim across web/bot processes. Failed sends return to the queue;
      // abandoned leases are recovered after five minutes below.
      const claimed = await db.notification.updateMany({ where: { id: notification.id, telegramStatus: "PENDING_FEEDBACK" }, data: { telegramStatus: "SENDING_FEEDBACK", telegramSentAt: new Date(), telegramAttempts: { increment: 1 } } });
      if (!claimed.count) continue;
      try {
        const url = new URL(notification.actionUrl!, process.env.WEBAPP_URL || "https://sentinel.piratezparty.com").toString();
        const message = await bot.api.sendMessage(notification.user.chatId, `<b>${escapeTelegramHtml(notification.title)}</b>\n\n${escapeTelegramHtml(notification.message)}`, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "View response", web_app: { url } }]] } });
        await db.notification.update({ where: { id: notification.id }, data: { telegramStatus: "SENT", telegramMessageId: message.message_id, telegramSentAt: new Date(), telegramLastError: null } });
      } catch {
        await db.notification.update({ where: { id: notification.id }, data: { telegramStatus: "PENDING_FEEDBACK", telegramLastError: "Telegram delivery pending" } });
      }
    }
    await db.notification.updateMany({ where: { telegramStatus: "SENDING_FEEDBACK", telegramSentAt: { lt: new Date(Date.now() - 300_000) } }, data: { telegramStatus: "PENDING_FEEDBACK" } });
  } finally { draining = false; }
}
