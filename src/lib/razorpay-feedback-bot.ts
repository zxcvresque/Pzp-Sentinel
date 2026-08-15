import type { Bot } from "grammy";
import type { PrismaClient } from "@/generated/prisma/client";
import { feedbackChoiceTransition } from "@/lib/razorpay-subscription-events";
import { logAuditEvent } from "@/lib/telegram-log";
import { escapeTelegramHtml } from "@/lib/telegram-format";

const CALLBACK_PATTERN = /^rzpfb:(wanted|cancelled):(yes|no):(.+)$/;

function yesNoKeyboard(step: "wanted" | "cancelled", feedbackId: string) {
  return {
    inline_keyboard: [[
      { text: "Yes", callback_data: `rzpfb:${step}:yes:${feedbackId}` },
      { text: "No", callback_data: `rzpfb:${step}:no:${feedbackId}` },
    ]],
  };
}

export function registerRazorpayFeedbackHandlers(bot: Bot, prisma: PrismaClient) {
  bot.callbackQuery(CALLBACK_PATTERN, async (ctx) => {
    const match = CALLBACK_PATTERN.exec(ctx.callbackQuery.data);
    if (!match) return;
    const [, rawStep, rawAnswer, feedbackId] = match;
    const step = rawStep as "wanted" | "cancelled";
    const answer = rawAnswer === "yes";

    const feedback = await prisma.razorpaySubscriptionFeedback.findUnique({
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

    const transition = feedbackChoiceTransition(step, answer);
    await prisma.razorpaySubscriptionFeedback.update({
      where: { id: feedback.id },
      data: { stage: transition.stage, ...transition.data },
    });
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});

    if (transition.stage === "ASK_CANCELLED") {
      await ctx.reply(transition.prompt, {
        reply_markup: yesNoKeyboard("cancelled", feedback.id),
      });
      return;
    }
    await ctx.reply(transition.prompt, {
      reply_markup: { force_reply: true, selective: true },
    });
  });

  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat.type !== "private") return next();
    const telegramId = ctx.from?.id.toString();
    const reason = ctx.message.text.trim();
    if (!telegramId || !reason || reason.startsWith("/")) return next();

    const feedback = await prisma.razorpaySubscriptionFeedback.findFirst({
      where: {
        user: { telegramId },
        stage: "AWAITING_REASON",
      },
      include: { user: true, subscription: true },
      orderBy: { updatedAt: "desc" },
    });
    if (!feedback) return next();

    const cleanReason = reason.slice(0, 1000);
    const completed = await prisma.razorpaySubscriptionFeedback.update({
      where: { id: feedback.id },
      data: { stage: "COMPLETED", reason: cleanReason, respondedAt: new Date() },
    });
    await ctx.reply("Thank you for letting us know. Your response has been saved and the admins have been notified privately.");

    const amount = `₹${(feedback.subscription.amount / 100).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
    const wanted = feedback.wantedToDonate === true ? "Yes" : "No";
    const deliberate = feedback.deliberateCancellation === null
      ? "Not asked"
      : feedback.deliberateCancellation ? "Yes" : "No";
    const message = [
      `${feedback.user.name} responded to a ${feedback.triggerAction.toLowerCase()} Razorpay autopay follow-up.`,
      `Wanted to continue donating: ${wanted}.`,
      `Deliberately cancelled: ${deliberate}.`,
      `Reason: ${cleanReason}`,
    ].join(" ");
    const telegramMessage =
      `<blockquote><b>Razorpay autopay response</b></blockquote>\n` +
      `<b>${escapeTelegramHtml(feedback.user.name)} · ${escapeTelegramHtml(amount)}</b>\n` +
      `Wanted to continue: <b>${wanted}</b>\n` +
      `Deliberately cancelled: <b>${deliberate}</b>\n` +
      `Reason: ${escapeTelegramHtml(cleanReason)}\n` +
      `<code>${escapeTelegramHtml(feedback.subscription.razorpaySubscriptionId)}</code>`;

    const admins = await prisma.user.findMany({
      where: { roles: { has: "ADMIN" }, status: "ACTIVE" },
      select: { id: true, chatId: true },
    });
    await Promise.allSettled(admins.map(async (admin) => {
      await prisma.notification.create({
        data: {
          userId: admin.id,
          type: "SYSTEM",
          title: "Donor replied about Razorpay autopay",
          message,
          entityId: feedback.subscriptionId,
          priority: "HIGH",
        },
      });
      if (admin.chatId) {
        await bot.api.sendMessage(admin.chatId, telegramMessage, { parse_mode: "HTML" });
      }
    }));

    await prisma.auditLog.create({
      data: {
        userId: feedback.userId,
        action: "RAZORPAY_SUBSCRIPTION_FEEDBACK",
        entityType: "RazorpaySubscriptionFeedback",
        entityId: completed.id,
        after: {
          triggerAction: feedback.triggerAction,
          wantedToDonate: feedback.wantedToDonate,
          deliberateCancellation: feedback.deliberateCancellation,
          reason: cleanReason,
        },
      },
    });
    logAuditEvent({
      action: "RAZORPAY_SUBSCRIPTION_FEEDBACK",
      entityType: "RazorpaySubscriptionFeedback",
      entityId: completed.id,
      userName: feedback.user.name,
      details: `${feedback.triggerAction} · wanted: ${wanted} · deliberate: ${deliberate}`,
    });
  });
}
