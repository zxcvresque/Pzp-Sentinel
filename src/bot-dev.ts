import "dotenv/config";
import { Bot } from "grammy";
import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { logAuditEvent } from "./lib/telegram-log";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const bot = new Bot(process.env.BOT_TOKEN!);

bot.command("start", async (ctx) => {
  const telegramId = ctx.from?.id.toString();
  const chatId = ctx.chat.id.toString();
  const username = ctx.from?.username || "";
  const firstName = ctx.from?.first_name || "Unknown";

  if (!telegramId) return;

  // Deep link: /start myid — reply with the user's Telegram ID
  const payload = ctx.match?.trim();
  if (payload === "myid") {
    await ctx.reply(
      `Your Telegram ID is:\n\n<code>${telegramId}</code>\n\nCopy it and paste it on the login page.`,
      { parse_mode: "HTML" },
    );
    return;
  }

  let user = await prisma.user.findUnique({ where: { telegramId } });

  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: { chatId },
    });
  }

  const webappUrl = process.env.WEBAPP_URL || "https://pzp.finance";

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

    logAuditEvent({
      action: "BOT_REGISTER",
      entityType: "User",
      entityId: created.id,
      userName: firstName,
      details: `@${username || telegramId} started the bot — awaiting role assignment`,
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

  if (user.roles.length === 0) {
    await ctx.reply(
      `Hey ${user.name}! 👋\n\n` +
      `You're in the system but don't have access yet. An admin will assign your role shortly.\n\n` +
      `Once approved, you'll be able to open Sentinel from right here.`,
    );
    return;
  }

  const roleLabels: Record<string, string> = {
    ADMIN: "🛡️ Admin — full treasury control",
    DONOR: "💚 Donor — submit & track donations",
    DEV: "⚡ Dev — project board & tasks",
  };

  const yourRoles = user.roles
    .map((r) => roleLabels[r] || r)
    .join("\n");

  await ctx.reply(
    `Welcome back, ${user.name}! 🏦\n\n` +
    `Your access:\n${yourRoles}\n\n` +
    `Open Sentinel to get started.`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Open Sentinel", web_app: { url: webappUrl } }],
        ],
      },
    }
  );
});

(async () => {
  await bot.api.deleteWebhook();
  console.log("Sentinel bot starting in polling mode...");
  bot.start({
    onStart: () => console.log("Sentinel bot is live! Send /start to @" + process.env.BOT_USERNAME),
  });
})();
