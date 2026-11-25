import type { Bot } from "grammy";
import type { PrismaClient } from "@/generated/prisma/client";
import { feedbackChoiceTransition } from "@/lib/razorpay-subscription-events";
import { saveBmcFeedback, drainBmcFeedbackDelivery } from "@/lib/bmc-feedback-service";
import { FeedbackError } from "@/lib/bmc-feedback-response";

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
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery({ text: "Please answer this form in your private Sentinel chat.", show_alert: true });
      return;
    }
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
    const changed = await prisma.bmcSubscriptionFeedback.updateMany({
      where: { id: feedback.id, stage: expectedStage },
      data: {
        stage: transition.stage, ...transition.data,
        ...(step === "wanted" ? { telegramChatId: ctx.chat!.id.toString(), telegramMessageId: ctx.callbackQuery.message?.message_id } : {}),
      },
    });
    if (!changed.count) {
      await ctx.answerCallbackQuery({ text: "This question has already been answered." });
      return;
    }
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

    try {
      await saveBmcFeedback(prisma, {
        id: feedback.id, userId: feedback.userId, source: "TELEGRAM",
        body: { wantedToDonate: feedback.wantedToDonate, deliberateCancellation: feedback.deliberateCancellation, reason },
      });
      await ctx.reply("Thank you. Your response has been saved and the admins have been notified. You can add additional information once in Sentinel.");
      await drainBmcFeedbackDelivery(prisma, bot);
    } catch (error) {
      if (error instanceof FeedbackError) await ctx.reply(error.message);
      else throw error;
    }
  });
}
