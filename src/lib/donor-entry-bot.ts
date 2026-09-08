import type { Context } from "grammy";
import { prisma } from "@/lib/db";
import { hashInviteToken, INVITE_TOKEN_PATTERN } from "./invite-token";

export async function handleDonorEntry(ctx: Context, payload: string | undefined) {
  if (!payload?.startsWith("donate_")) return false;
  if (ctx.chat?.type !== "private" || !ctx.from) return true;
  const token = payload.slice(7);
  if (!INVITE_TOKEN_PATTERN.test(token)) { await ctx.reply("Invalid payment invitation."); return true; }
  const telegramId = String(ctx.from.id), now = new Date();
  const invite = await prisma.oneTimeDonationInvite.findUnique({ where: { tokenHash: hashInviteToken(token) } });
  if (!invite || invite.usedAt || invite.revokedAt || invite.expiresAt <= now) {
    await ctx.reply("This payment invitation has expired or been used. Open Donate in Sentry for a new link."); return true;
  }
  const claim = await prisma.oneTimeDonationInvite.updateMany({
    where: { id: invite.id, usedAt: null, revokedAt: null, expiresAt: { gt: now }, OR: [{ telegramId: null }, { telegramId }] },
    data: { telegramId, telegramUser: ctx.from.username || null, claimedAt: now },
  });
  if (claim.count !== 1) { await ctx.reply("This payment invitation belongs to another Telegram account."); return true; }
  const base = (process.env.WEBAPP_URL || "").replace(/\/$/, "");
  if (!base.startsWith("https://")) throw new Error("WEBAPP_URL must use HTTPS");
  await ctx.reply("Your Telegram identity is verified. Continue to your one-time donation options:", {
    reply_markup: { inline_keyboard: [[{ text: "Continue to payment options", web_app: { url: `${base}/donate/${token}` } }]] },
  });
  return true;
}
