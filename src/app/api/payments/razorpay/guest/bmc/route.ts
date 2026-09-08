import { getOneTimeDonationInvite } from "@/lib/razorpay";
import { prisma } from "@/lib/db";
import { generateBmcAttributionCode, hashBmcAttributionCode } from "@/lib/bmc-attribution";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try { return await prepare(request); }
  catch { return Response.json({ error: "Could not prepare the BMC payment reference. Please try again shortly." }, { status: 503 }); }
}

async function prepare(request: Request) {
  const { token } = await request.json().catch(() => ({}));
  const invite = await getOneTimeDonationInvite(typeof token === "string" ? token : "");
  if (!invite?.telegramId || !invite.claimedAt || invite.revokedAt || invite.usedAt || invite.expiresAt <= new Date()) return Response.json({ error: "Verify an active invitation in Telegram first" }, { status: 403 });
  const checkoutUrl = process.env.BMC_PAGE_URL?.trim();
  if (!checkoutUrl || !process.env.BMC_WEBHOOK_SECRET) return Response.json({ error: "BMC is not configured" }, { status: 503 });
  const code = generateBmcAttributionCode();
  const intent = await prisma.$transaction(async db => {
    const locked = await db.oneTimeDonationInvite.updateMany({ where: { id: invite.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { claimedAt: invite.claimedAt } });
    if (locked.count !== 1) throw new Error("Invitation is no longer available");
    const user = await db.user.upsert({ where: { telegramId: invite.telegramId! }, update: {}, create: {
      telegramId: invite.telegramId!, telegramUser: invite.telegramUser || '', name: invite.guestName, roles: [],
    } });
    await db.bmcCheckoutIntent.updateMany({ where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { expiresAt: new Date() } });
    // A guest receives an attribution reference, never a donor/admin role.
    const created = await db.bmcCheckoutIntent.create({ data: { userId: user.id, codeHash: hashBmcAttributionCode(code), donationFrequency: "ONE_TIME", expiresAt: invite.expiresAt } });
    await db.$executeRaw`INSERT INTO donor_bridge_bmc_intents(intent_id,invite_id) VALUES(${created.id},${invite.id})`;
    return created;
  });
  return Response.json({ code, checkoutUrl, expiresAt: intent.expiresAt, donationFrequency: "ONE_TIME" });
}
