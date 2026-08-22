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

bot.command("start", async (ctx) => {
  const telegramId = ctx.from?.id.toString();
  const chatId = ctx.chat.id.toString();
  const username = ctx.from?.username || "";
  const firstName = ctx.from?.first_name || "Unknown";

  if (!telegramId) return;

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

    await ctx.reply(
      `Hey ${firstName}! 👋\n\n` +
      `I'm Sentinel — the bot for PzP's finance & developer hub.\n\n` +
      `Here's what PzP Sentinel does:\n` +
      `💰 Tracks community treasury — donations, expenses, subscriptions\n` +
      `📋 Manages developer tasks & project boards\n` +
      `🔔 Sends payment reminders & notifications\n` +
      `📊 Keeps everything transparent for the community\n\n` +
      `You're not registered yet. An admin will review and assign your access shortly. Sit tight!`,
    );
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

  // In database but no roles — waiting for admin approval
  if (user.roles.length === 0) {
    await ctx.reply(
      `Hey ${user.name}! 👋\n\n` +
      `You're in the system but don't have access yet. An admin will assign your role shortly.\n\n` +
      `Once approved, you'll be able to open Sentinel from right here.`,
    );
    return;
  }

  // Registered user with roles
  const roleLabels: Record<string, string> = {
    ADMIN: "🛡️ Admin — full treasury control",
    DONOR: "💚 Donor — submit & track donations",
    DEV: "⚡ Dev — project board & tasks",
  };

  const yourRoles = user.roles
    .map((r) => roleLabels[r] || r)
    .join("\n");
  const donorWebsite = user.roles.includes("DONOR")
    ? `\n\nYou can also use Sentinel directly at <a href="https://sentinel.piratezparty.com">sentinel.piratezparty.com</a>.`
    : "";

  await ctx.reply(
    `Welcome back, ${escapeTelegramHtml(user.name)}! 🏦\n\n` +
    `Your access:\n${yourRoles}\n\n` +
    `Open Sentinel to get started.${donorWebsite}`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "Open Sentinel", web_app: { url: webappUrl } }],
        ],
      },
    }
  );
});

registerRazorpayFeedbackHandlers(bot, prisma);
registerBmcFeedbackHandlers(bot, prisma);

const handleUpdate = webhookCallback(bot, "std/http");

export async function POST(req: NextRequest) {
  const secretToken = req.headers.get("x-telegram-bot-api-secret-token");
  if (process.env.BOT_WEBHOOK_SECRET && secretToken !== process.env.BOT_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return await handleUpdate(req);
  } catch {
    return NextResponse.json({ ok: true });
  }
}
