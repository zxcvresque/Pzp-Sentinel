import { after, NextRequest, NextResponse } from "next/server";
import { bot } from "@/lib/bot";
import { prisma } from "@/lib/db";
import { refreshStoredTelegramAvatar } from "@/lib/telegram-avatar-refresh";
import { logAuditEvent } from "@/lib/telegram-log";
import { webhookCallback } from "grammy";
import { escapeTelegramHtml } from "@/lib/telegram-format";
import { registerRazorpayFeedbackHandlers } from "@/lib/razorpay-feedback-bot";
import { registerBmcFeedbackHandlers } from "@/lib/bmc-feedback-bot";
import { notifyAdmins } from "@/lib/notifications";
import { handleSharedLinkStart } from "@/lib/shared-link-bot";
import { handleDonorEntry } from "@/lib/donor-entry-bot";
import { startMessage } from "@/lib/start-message";

bot.command("start", async (ctx) => {
  const telegramId = ctx.from?.id.toString();
  const chatId = ctx.chat.id.toString();
  const username = ctx.from?.username || "";
  const firstName = ctx.from?.first_name || "Unknown";

  if (!telegramId) return;

  const payload = ctx.match?.trim();
  if (await handleDonorEntry(ctx, payload)) return;
  if (await handleSharedLinkStart(ctx, payload)) return;

  if (payload?.startsWith("auth_")) {
    const nonce = payload.slice(5);
    if (!/^[0-9a-f]{32}$/i.test(nonce)) {
      await ctx.reply("This login link is invalid. Return to Sentinel and try again.");
      return;
    }

    const loginToken = await prisma.loginToken.findUnique({ where: { nonce } });
    if (!loginToken || loginToken.status !== "PENDING" || loginToken.expiresAt < new Date()) {
      await ctx.reply("This login link has already been used or expired. Return to Sentinel and request a new one.");
      return;
    }

    let authUser = await prisma.user.findUnique({ where: { telegramId } });
    if (!authUser) {
      authUser = await prisma.user.create({
        data: { telegramId, telegramUser: username, name: firstName, chatId, roles: [] },
      });
    }
    await prisma.loginToken.update({ where: { nonce }, data: { telegramId, status: "VERIFIED" } });

    const resumeUrl = new URL("/login", process.env.WEBAPP_URL || "https://pzp.finance");
    resumeUrl.searchParams.set("login_nonce", nonce);
    await ctx.reply(
      `<blockquote><b>✅ Login Verified</b></blockquote>\n` +
      `<b>${escapeTelegramHtml(authUser.name)}</b>, return to the Sentinel window to finish signing in.`,
      {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "Return to Sentinel", web_app: { url: resumeUrl.toString() } }]] },
      },
    );

    const storedAuthUser = authUser;
    after(async () => {
      await Promise.allSettled([
        prisma.user.update({
          where: { id: storedAuthUser.id },
          data: { chatId, ...(username && { telegramUser: username }), name: firstName || storedAuthUser.name },
        }),
        refreshStoredTelegramAvatar({ userId: storedAuthUser.id, telegramId, userName: firstName }),
      ]);
    });
    return;
  }

  const user = await prisma.user.findUnique({ where: { telegramId } });

  const webappUrl = process.env.WEBAPP_URL || "https://pzp.finance";

  // Unknown person — not in the database at all
  if (!user) {
    const created = await prisma.user.create({
      data: {
        telegramId,
        telegramUser: username,
        name: firstName,
        chatId,
        roles: [],
      },
    });

    after(async () => {
      await Promise.allSettled([
        refreshStoredTelegramAvatar({
          userId: created.id,
          telegramId,
          userName: firstName,
        }),
        logAuditEvent({
          action: "BOT_REGISTER",
          entityType: "User",
          entityId: created.id,
          userName: firstName,
          details: `@${username || telegramId} started the bot — awaiting role assignment`,
        }),
        notifyAdmins({
          type: "USER_REGISTERED",
          title: "New User Started Bot",
          message: `${firstName} (@${username || telegramId}) started the bot and is awaiting role assignment.`,
          entityId: created.id,
          priority: "HIGH",
          actionUrl: "/admin/users",
          telegramMessage:
            `<blockquote><b>🆕 New User Started Bot</b></blockquote>\n` +
            `<b>${escapeTelegramHtml(firstName)}</b> (@${escapeTelegramHtml(username || telegramId)})\n` +
            `<i>Awaiting role assignment</i>`,
        }),
      ]);
    });

    await ctx.reply(startMessage(created).text, { parse_mode: "HTML" });
    return;
  }

  after(async () => {
    await Promise.allSettled([
      prisma.user.update({
        where: { id: user.id },
        data: {
          chatId,
          ...(username && { telegramUser: username }),
          name: firstName || user.name,
        },
      }),
      refreshStoredTelegramAvatar({
        userId: user.id,
        telegramId,
        userName: firstName,
      }),
    ]);
  });

  const welcome = startMessage(user);
  await ctx.reply(welcome.text, {
    parse_mode: "HTML",
    ...(welcome.route && welcome.button ? {
      reply_markup: { inline_keyboard: [[{ text: welcome.button, web_app: { url: new URL(welcome.route, webappUrl).toString() } }]] },
    } : {}),
  });
});

registerRazorpayFeedbackHandlers(bot, prisma);
registerBmcFeedbackHandlers(bot, prisma);

const handleUpdate = webhookCallback(bot, "std/http");

export async function POST(req: NextRequest) {
  const configuredSecret = process.env.BOT_WEBHOOK_SECRET;
  if (!configuredSecret) {
    console.error("[bot-webhook] BOT_WEBHOOK_SECRET is not configured; refusing update");
    return NextResponse.json({ error: "Webhook unavailable" }, { status: 503 });
  }
  const secretToken = req.headers.get("x-telegram-bot-api-secret-token");
  if (secretToken !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return await handleUpdate(req);
  } catch (error) {
    console.error("[bot-webhook] Telegram update failed", error);
    return NextResponse.json({ error: "Update processing failed" }, { status: 500 });
  }
}
