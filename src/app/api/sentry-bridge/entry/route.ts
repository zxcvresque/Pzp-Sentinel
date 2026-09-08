import { randomBytes } from "node:crypto";
import { bridgeAuthorized, bridgePool } from "@/lib/donor-bridge";
import { prisma } from "@/lib/db";
import { hashInviteToken } from "@/lib/invite-token";
import { encryptSecret, decryptSecret } from "@/lib/secret-crypto";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!bridgeAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const telegramId = String(body.telegramId || "");
  if (!/^[1-9]\d{4,15}$/.test(telegramId)) return Response.json({ error: "Invalid Telegram ID" }, { status: 400 });
  const username = (process.env.BOT_USERNAME || process.env.NEXT_PUBLIC_BOT_USERNAME || "").replace(/^@/, "");
  if (!/^[A-Za-z0-9_]+bot$/i.test(username)) return Response.json({ error: "Sentinel bot username is not configured" }, { status: 503 });
  if (body.frequency === "MONTHLY") return Response.json({ url: `https://t.me/${username}?start=monthly` });
  if (body.frequency !== "ONE_TIME") return Response.json({ error: "Invalid frequency" }, { status: 400 });
  const client = await bridgePool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`donor-entry:${telegramId}`]);
    const previous = await client.query("SELECT * FROM donor_bridge_entries WHERE telegram_id=$1 AND expires_at>now()", [telegramId]);
    if (previous.rows[0]) {
      const invite = await prisma.oneTimeDonationInvite.findUnique({ where: { id: previous.rows[0].invite_id } });
      if (invite && !invite.usedAt && !invite.revokedAt) {
        await client.query("COMMIT");
        return Response.json({ url: `https://t.me/${username}?start=donate_${decryptSecret(previous.rows[0].token_cipher)}` });
      }
    }
    const creator = await prisma.user.findFirst({ where: { telegramId: "1800754304", roles: { has: "ADMIN" }, status: "ACTIVE" } });
    if (!creator) throw new Error("Bridge invite administrator is not available");
    const token = randomBytes(32).toString("base64url");
    // Reserved for the authenticated Sentry identity. claimedAt stays null until
    // that same person actually starts Sentinel; opening the URL is not a login.
    const invite = await prisma.oneTimeDonationInvite.create({ data: {
      tokenHash: hashInviteToken(token), guestName: String(body.name || "Community donor").slice(0,80),
      telegramId, note: "One-time community contribution", allowRazorpay: true,
      createdById: creator.id, expiresAt: new Date(Date.now()+86400000),
    } });
    await client.query("INSERT INTO donor_bridge_entries VALUES($1,$2,$3,$4) ON CONFLICT(telegram_id) DO UPDATE SET token_cipher=excluded.token_cipher,invite_id=excluded.invite_id,expires_at=excluded.expires_at", [telegramId, encryptSecret(token), invite.id, invite.expiresAt]);
    await client.query("COMMIT");
    return Response.json({ url: `https://t.me/${username}?start=donate_${token}` });
  } catch { await client.query("ROLLBACK"); return Response.json({ error: "Could not create invitation; try again later" }, { status: 503 }); }
  finally { client.release(); }
}
