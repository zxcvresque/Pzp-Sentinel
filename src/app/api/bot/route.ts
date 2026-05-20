import { NextRequest, NextResponse } from "next/server";
import { bot } from "@/lib/bot";
import { prisma } from "@/lib/db";
import { webhookCallback } from "grammy";

bot.command("start", async (ctx) => {
  const telegramId = ctx.from?.id.toString();
  const chatId = ctx.chat.id.toString();

  if (!telegramId) return;

  const user = await prisma.user.findUnique({ where: { telegramId } });

  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: { chatId },
    });
  }

  const webappUrl = process.env.WEBAPP_URL || "https://pzp.finance";

  await ctx.reply(
    "Welcome to *PzP Finance*\\! 🏦\n\nOpen the webapp to manage your community treasury\\.",
    {
      parse_mode: "MarkdownV2",
      reply_markup: {
        inline_keyboard: [
          [{ text: "Open PzP Finance", web_app: { url: webappUrl } }],
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
