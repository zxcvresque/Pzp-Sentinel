import { NextRequest, NextResponse } from "next/server";
import { bot } from "@/lib/bot";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/telegram-log";
import { webhookCallback } from "grammy";

bot.command("start", async (ctx) => {
  const telegramId = ctx.from?.id.toString();
  const chatId = ctx.chat.id.toString();
  const username = ctx.from?.username || "";
  const firstName = ctx.from?.first_name || "Unknown";

  if (!telegramId) return;

  let user = await prisma.user.findUnique({ where: { telegramId } });

  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: { chatId },
    });
  } else {
    user = await prisma.user.create({
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
      entityId: user.id,
      userName: firstName,
      details: `@${username || telegramId} started the bot — awaiting role assignment`,
    });
  }

  const webappUrl = process.env.WEBAPP_URL || "https://pzp.finance";

  if (user.roles.length === 0) {
    await ctx.reply(
      "Welcome to PzP Finance! 🏦\n\nYou've been registered. An admin will assign your role shortly.",
    );
  } else {
    await ctx.reply(
      "Welcome back to PzP Finance! 🏦\n\nOpen the webapp to manage your community treasury.",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Open PzP Finance", web_app: { url: webappUrl } }],
          ],
        },
      }
    );
  }
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
