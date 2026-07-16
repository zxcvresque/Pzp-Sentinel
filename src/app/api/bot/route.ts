import { NextRequest, NextResponse } from "next/server";
import { bot, fetchTelegramPhotoUrl } from "@/lib/bot";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/telegram-log";
import { webhookCallback } from "grammy";

bot.command("start", async (ctx) => {
  const telegramId = ctx.from?.id.toString();
  const chatId = ctx.chat.id.toString();
  const username = ctx.from?.username || "";
  const firstName = ctx.from?.first_name || "Unknown";

  if (!telegramId) return;

  // Fetch profile photo from Telegram
  const photoUrl = await fetchTelegramPhotoUrl(telegramId, firstName);

  const user = await prisma.user.findUnique({ where: { telegramId } });

  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        chatId,
        ...(photoUrl && { photoUrl }),
        ...(username && { telegramUser: username }),
        name: firstName || user.name,
      },
    });
  }

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
        ...(photoUrl && { photoUrl }),
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
