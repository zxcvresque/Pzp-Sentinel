import type { Bot } from "grammy";
import type { PrismaClient } from "@/generated/prisma/client";
import { feedbackChoiceTransition } from "@/lib/razorpay-subscription-events";
import { escapeTelegramHtml } from "@/lib/telegram-format";
import { logAuditEvent } from "@/lib/telegram-log";

const CALLBACK_PATTERN = /^bmcfb:(wanted|cancelled):(yes|no):(.+)$/;

function yesNoKeyboard(step: "wanted" | "cancelled", feedbackId: string) {
  return {
    inline_keyboard: [[
      { text: "Yes", callback_data: `bmcfb:${step}:yes:${feedbackId}` },
      { text: "No", callback_data: `bmcfb:${step}:no:${feedbackId}` },
    ]],
  };
}

export function registerBmcFeedbackHandlers(bot: Bot, prisma: PrismaClient) {
  bot.callbackQuery(CALLBACK_PATTERN, async (ctx) => {
    const match = CALLBACK_PATTERN.exec(ctx.callbackQuery.data);
    if (!match) return;
    const [, rawStep, rawAnswer, feedbackId] = match;
    const step = rawStep as "wanted" | "cancelled";
    const feedback = await prisma.bmcSubscriptionFeedback.findUnique({
      where: { id: feedbackId },
      include: { user: true },
    });
    if (!feedback || feedback.user.telegramId !== ctx.from.id.toString()) {
      await ctx.answerCallbackQuery({ text: "This response request is not available.", show_alert: true });
      return;
    }
    const expectedStage = step === "wanted" ? "ASK_WANTED" : "ASK_CANCELLED";
    if (feedback.stage !== expectedStage) {
      await ctx.answerCallbackQuery({ text: "This question has already been answered." });
      return;
    }

    const transition = feedbackChoiceTransition(step, rawAnswer === "yes");
    await prisma.bmcSubscriptionFeedback.update({
      where: { id: feedback.id },
      data: { stage: transition.stage, ...transition.data },
    });
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
    if (transition.stage === "ASK_CANCELLED") {
      await ctx.reply(transition.prompt, { reply_markup: yesNoKeyboard("cancelled", feedback.id) });
    } else {
      await ctx.reply(transition.prompt, { reply_markup: { force_reply: true, selective: true } });
    }
  });

  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat.type !== "private") return next();
    const telegramId = ctx.from?.id.toString();
    const reason = ctx.message.text.trim();
    if (!telegramId || !reason || reason.startsWith("/")) return next();

    const feedback = await prisma.bmcSubscriptionFeedback.findFirst({
      where: { user: { telegramId }, stage: "AWAITING_REASON" },
      include: { user: true },
      orderBy: { updatedAt: "desc" },
    });
    if (!feedback) return next();

    const cleanReason = reason.slice(0, 1000);
    const completed = await prisma.bmcSubscriptionFeedback.update({
      where: { id: feedback.id },
      data: { stage: "COMPLETED", reason: cleanReason, respondedAt: new Date() },
    });
    await ctx.reply("Thank you for letting us know. Your response has been saved and the admins have been notified privately.");

    const amount = feedback.amount == null
      ? "Amount unavailable"
      : `${feedback.currency === "INR" ? "₹" : "$"}${Number(feedback.amount).toFixed(2)}`;
    const wanted = feedback.wantedToDonate === true ? "Yes" : "No";
    const deliberate = feedback.deliberateCancellation === null
      ? "Not asked"
      : feedback.deliberateCancellation ? "Yes" : "No";
    const message = [
      `${feedback.user.name} responded to a BMC ${feedback.triggerType} follow-up.`,
      `Wanted to continue donating: ${wanted}.`,
      `Deliberately cancelled: ${deliberate}.`,
      `Reason: ${cleanReason}`,
    ].join(" ");
    const telegramMessage =
      `<blockquote><b>BMC recurring-support response</b></blockquote>\n` +
      `<b>${escapeTelegramHtml(feedback.user.name)} · ${escapeTelegramHtml(amount)}</b>\n` +
      `Wanted to continue: <b>${wanted}</b>\n` +
      `Deliberately cancelled: <b>${deliberate}</b>\n` +
      `Reason: ${escapeTelegramHtml(cleanReason)}\n` +
      (feedback.supporterId ? `<code>${escapeTelegramHtml(feedback.supporterId)}</code>` : "");

    const admins = await prisma.user.findMany({
      where: { roles: { has: "ADMIN" }, status: "ACTIVE" },
      select: { id: true, chatId: true },
    });
    await Promise.allSettled(admins.map(async (admin) => {
      await prisma.notification.create({
        data: {
          userId: admin.id,
          type: "SYSTEM",
          title: "Donor replied about BMC recurring support",
          message,
          entityId: feedback.id,
          priority: "HIGH",
        },
      });
      if (admin.chatId) await bot.api.sendMessage(admin.chatId, telegramMessage, { parse_mode: "HTML" });
    }));
    await prisma.auditLog.create({
      data: {
        userId: feedback.userId,
        action: "BMC_SUBSCRIPTION_FEEDBACK",
        entityType: "BmcSubscriptionFeedback",
        entityId: completed.id,
        after: {
          triggerType: feedback.triggerType,
          wantedToDonate: feedback.wantedToDonate,
          deliberateCancellation: feedback.deliberateCancellation,
          reason: cleanReason,
        },
      },
    });
    logAuditEvent({
      action: "BMC_SUBSCRIPTION_FEEDBACK",
      entityType: "BmcSubscriptionFeedback",
      entityId: completed.id,
      userName: feedback.user.name,
      details: `${feedback.triggerType} · wanted: ${wanted} · deliberate: ${deliberate}`,
    });
  });
}
