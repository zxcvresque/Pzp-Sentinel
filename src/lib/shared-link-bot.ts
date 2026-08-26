import type { Context } from "grammy";
import { prisma } from "@/lib/db";
import { escapeTelegramHtml } from "@/lib/telegram-format";
import { shareBaseUrl, shareStartCode } from "@/lib/share-links";

export async function handleSharedLinkStart(ctx: Context, payload: string | undefined) {
  const code = shareStartCode(payload);
  if (code === null) return false;
  if (!code) {
    await ctx.reply("This Sentinel handoff link is invalid.");
    return true;
  }

  const telegramId = ctx.from?.id.toString();
  const [shareLink, user] = await Promise.all([
    prisma.shareLink.findUnique({ where: { code }, select: { title: true, details: true } }),
    telegramId ? prisma.user.findUnique({ where: { telegramId }, select: { status: true, roles: true } }) : null,
  ]);
  if (!shareLink) {
    await ctx.reply("This Sentinel handoff link no longer exists.");
    return true;
  }
  if (!user || user.status !== "ACTIVE" || !user.roles.includes("ADMIN")) {
    await ctx.reply("This Sentinel handoff is available only to active administrators.");
    return true;
  }

  const baseUrl = shareBaseUrl("https://sentinel.piratezparty.com");
  const websiteUrl = `${baseUrl}/${code}?open=website`;
  const webAppUrl = `${baseUrl}/${code}?open=webapp`;
  const context = shareLink.details
    ? `\n${escapeTelegramHtml(shareLink.details)}`
    : "";
  await ctx.reply(
    `<blockquote><b>Shared with you</b></blockquote>\n` +
    `<b>${escapeTelegramHtml(shareLink.title)}</b>${context}\n\n` +
    `<b>Open in:</b>`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[
          { text: "🩵 Website", url: websiteUrl, style: "primary" },
          { text: "🩷 Web App", web_app: { url: webAppUrl }, style: "danger" },
        ]],
      },
    },
  );
  return true;
}
