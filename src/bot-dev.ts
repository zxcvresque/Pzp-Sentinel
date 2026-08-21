import "dotenv/config";
import { Bot } from "grammy";
import { PrismaClient, Prisma } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { logAuditEvent, postDonationThanks } from "./lib/telegram-log";
import {
  donateReminderMessage,
  donorHandle,
  monthlyDonationReminderGroupMessage,
} from "./lib/donation-thanks";
import { reminderDue } from "./lib/donation-reminders";
import { drainFinanceAutomationQueue } from "./lib/finance-sheets";
import { hashInviteToken, INVITE_TOKEN_PATTERN } from "./lib/invite-token";
import { fetchTelegramPhotoUrl } from "./lib/bot";
import { registerRazorpayFeedbackHandlers } from "./lib/razorpay-feedback-bot";
import { registerBmcFeedbackHandlers } from "./lib/bmc-feedback-bot";
import { nextReminderFire } from "./lib/admin-reminders";
import { broadcastAudienceRoles } from "./lib/broadcast-audience";
import { broadcastInlineToTelegramHtml, broadcastToTelegramHtml } from "./lib/broadcast-format";
import { serviceReminderRepeat } from "./lib/service-templates";
import { reconcileRecentRazorpaySubscriptionPayments } from "./lib/razorpay";
import { reconcileDonationAnnouncements } from "./lib/donation-announcement";
import { notifyVpsAlertSubscribers } from "./lib/vps-alerts";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL!,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});
pool.on("error", (err) => {
  console.error("Bot DB pool error (non-fatal):", err.message);
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const bot = new Bot(process.env.BOT_TOKEN!);

function escapeBotHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Check if an error is a transient DB connection failure worth retrying
function isTransientDbError(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  const msg = String(err);
  return !!(
    code === "P1017" || code === "P1001" || code === "ECONNRESET" ||
    code === "ECONNREFUSED" || code === "ETIMEDOUT" ||
    msg.includes("Connection terminated") || msg.includes("closed the connection") ||
    msg.includes("ECONNRESET")
  );
}

// Retry wrapper — flush dead pool connections between retries
async function dbRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try {
      if (i > 0) {
        // Warm up: grab and release a fresh connection to flush dead ones
        try { const c = await pool.connect(); c.release(); } catch { /* pool will reconnect */ }
      }
      return await fn();
    } catch (err: unknown) {
      if (i < retries && isTransientDbError(err)) {
        console.warn(`DB retry ${i + 1}/${retries} — ${(err as { code?: string }).code || "connection dropped"}`);
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error("dbRetry exhausted");
}

/**
 * Notify all active admins from the bot process.
 * Creates in-app Notification rows + sends Telegram DMs.
 */
async function notifyAdminsFromBot(
  db: typeof prisma,
  botInstance: typeof bot,
  data: {
    type: string;
    title: string;
    message: string;
    entityId?: string;
    priority?: string;
    telegramMessage?: string;
    channel?: "BOT" | "WEB" | "BOTH";
    targetUserIds?: string[];
  },
) {
  try {
    const admins = await dbRetry(() =>
      db.user.findMany({
        where: { roles: { has: "ADMIN" }, status: "ACTIVE", ...(data.targetUserIds?.length ? { id: { in: data.targetUserIds } } : {}) },
        select: { id: true, chatId: true, dmPreferences: true },
      }),
    );

    console.log(`[notifyAdmins] Found ${admins.length} admin(s) to notify for ${data.type}`);

    for (const admin of admins) {
      // In-app notification
      if (data.channel !== "BOT") {
        try {
          await dbRetry(() =>
            db.notification.create({
              data: {
                userId: admin.id,
                type: data.type as never,
                title: data.title,
                message: data.message,
                entityId: data.entityId,
                priority: data.priority || "NORMAL",
              },
            }),
          );
          console.log(`[notifyAdmins] In-app notification created for admin ${admin.id}`);
        } catch (err) {
          console.error(`[notifyAdmins] Failed to create notification for admin ${admin.id}:`, err);
        }
      }

      // Telegram DM
      if (data.channel !== "WEB" && admin.chatId && data.telegramMessage) {
        const hasPref = admin.dmPreferences.includes(data.type);
        console.log(`[notifyAdmins] Admin ${admin.id} chatId=${admin.chatId} hasPref=${hasPref}`);
        if (hasPref) {
          try {
            await botInstance.api.sendMessage(admin.chatId, data.telegramMessage, {
              parse_mode: "HTML",
            });
            console.log(`[notifyAdmins] DM sent to admin ${admin.id}`);
          } catch (err) {
            console.error(`[notifyAdmins] DM failed for admin ${admin.id}:`, err);
          }
        }
      }
    }
  } catch (err) {
    console.error("[notifyAdmins] Top-level failure:", err);
  }
}

const TELEGRAM_WEBHOOK_DELETE_ATTEMPTS = 5;

function isTransientTelegramApiError(error: unknown) {
  const candidate = error as {
    error_code?: number;
    code?: string;
    description?: string;
    message?: string;
  };
  const status = candidate.error_code;
  const message = `${candidate.description || ""} ${candidate.message || ""}`;
  return status === 429 || (typeof status === "number" && status >= 500)
    || ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH"].includes(candidate.code || "")
    || /gateway timeout|network error|fetch failed/i.test(message);
}

/**
 * Long polling requires Telegram webhooks to be removed. Telegram can return a
 * 504 even when it completed that deletion, so verify the state and retry
 * transient failures instead of letting PM2 immediately restart the bot.
 */
async function prepareTelegramPolling() {
  let lastError: unknown;
  for (let attempt = 1; attempt <= TELEGRAM_WEBHOOK_DELETE_ATTEMPTS; attempt++) {
    try {
      await bot.api.deleteWebhook();
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientTelegramApiError(error)) throw error;

      try {
        const webhook = await bot.api.getWebhookInfo();
        if (!webhook.url) {
          console.warn("[telegram] deleteWebhook timed out, but no webhook remains; starting polling.");
          return;
        }
      } catch (statusError) {
        if (!isTransientTelegramApiError(statusError)) throw statusError;
      }

      if (attempt === TELEGRAM_WEBHOOK_DELETE_ATTEMPTS) break;
      const delayMs = 1_000 * 2 ** (attempt - 1);
      console.warn(`[telegram] deleteWebhook failed (attempt ${attempt}/${TELEGRAM_WEBHOOK_DELETE_ATTEMPTS}); retrying in ${delayMs / 1_000}s.`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

// ── Admin reminders and repeating broadcasts ─────────────────────────────────
const ADMIN_MESSAGE_CHECK_INTERVAL = 60 * 1000;
const PROVIDER_RECONCILIATION_INTERVAL = 6 * 60 * 60 * 1000;

async function reconcileProviderPayments() {
  try {
    const result = await reconcileRecentRazorpaySubscriptionPayments();
    console.log(`[razorpay-reconcile] checked=${result.checked}, recovered=${result.recovered}, skipped=${result.skipped}, errors=${result.errors.length}`);
    if (result.errors.length) console.warn("[razorpay-reconcile]", result.errors.slice(0, 5));
  } catch (error) {
    console.error("[razorpay-reconcile] Failed:", error);
  }

  try {
    const result = await reconcileDonationAnnouncements();
    console.log(`[donation-announcements] checked=${result.checked}, sent=${result.sent}, skipped=${result.skipped}, failed=${result.failed}`);
  } catch (error) {
    console.error("[donation-announcements] Reconciliation failed:", error);
  }
}

async function checkAdminReminders() {
  try {
    const now = new Date();
    const due = await dbRetry(() => prisma.reminder.findMany({
      where: { active: true, nextFire: { lte: now } },
      orderBy: { nextFire: "asc" },
      take: 50,
    }));

    for (const reminder of due) {
      const next = nextReminderFire(
        reminder.nextFire,
        now,
        reminder.frequency,
        reminder.repeatEvery,
        reminder.repeatUnit,
      );
      const claimed = await dbRetry(() => prisma.reminder.updateMany({
        where: { id: reminder.id, active: true, nextFire: reminder.nextFire },
        data: {
          active: next !== null,
          nextFire: next ?? reminder.nextFire,
          lastFiredAt: now,
        },
      }));
      if (claimed.count !== 1) continue;

      await notifyAdminsFromBot(prisma, bot, {
        type: "REMINDER",
        title: "Admin reminder",
        message: reminder.message,
        entityId: reminder.id,
        channel: reminder.channel,
        targetUserIds: reminder.ownerId ? [reminder.ownerId] : undefined,
        telegramMessage: `<blockquote><b>🔔 Admin reminder</b></blockquote>\n${escapeBotHtml(reminder.message)}`,
      });
      console.log(`[admin-reminder] Sent ${reminder.id}; next=${next?.toISOString() ?? "complete"}`);
    }

    const escalations = await dbRetry(() => prisma.reminder.findMany({
      where: { escalationAt: { lte: now }, escalatedAt: null, acknowledgedAt: null, lastFiredAt: { not: null } },
      take: 50,
    }));
    for (const reminder of escalations) {
      const claimed = await dbRetry(() => prisma.reminder.updateMany({ where: { id: reminder.id, escalatedAt: null, acknowledgedAt: null }, data: { escalatedAt: now } }));
      if (claimed.count !== 1) continue;
      await notifyAdminsFromBot(prisma, bot, {
        type: "REMINDER",
        title: "Unacknowledged reminder escalated",
        message: reminder.message,
        entityId: reminder.id,
        priority: "HIGH",
        channel: reminder.channel,
        telegramMessage: `<blockquote><b>⚠️ Reminder escalated</b></blockquote>\n${escapeBotHtml(reminder.message)}`,
      });
    }
  } catch (err) {
    console.error("[admin-reminder] Check failed:", err);
  }
}

async function checkScheduledBroadcasts() {
  try {
    const now = new Date();
    const due = await dbRetry(() => prisma.scheduledBroadcast.findMany({
      where: { active: true, nextFire: { lte: now } },
      orderBy: { nextFire: "asc" },
      take: 20,
      include: { createdBy: { select: { name: true } } },
    }));

    for (const schedule of due) {
      const scheduledFor = schedule.nextFire;
      const next = nextReminderFire(
        scheduledFor,
        now,
        "CUSTOM",
        schedule.repeatEvery,
        schedule.repeatUnit,
      );
      if (!next) continue;
      const claimed = await dbRetry(() => prisma.scheduledBroadcast.updateMany({
        where: { id: schedule.id, active: true, nextFire: scheduledFor },
        data: { nextFire: next, lastFiredAt: now, lastError: null },
      }));
      if (claimed.count !== 1) continue;

      const errors: string[] = [];
      const roles = broadcastAudienceRoles(schedule.audience);
      const recipients = await dbRetry(() => prisma.user.findMany({
        where: {
          roles: { hasSome: roles },
          status: "ACTIVE",
          ...(schedule.recipientMode === "SELECTED" ? { id: { in: schedule.recipientIds } } : {}),
        },
        select: { id: true, chatId: true },
      }));
      const occurrenceId = `broadcast:${schedule.id}:${scheduledFor.toISOString()}`;
      const telegramMessage = `<blockquote>📣 ${broadcastInlineToTelegramHtml(schedule.title)}</blockquote>\n${broadcastToTelegramHtml(schedule.message)}\n\n<i>— ${escapeBotHtml(schedule.createdBy.name)}, Sentinel</i>`;

      if (schedule.sendSentinel) {
        for (const recipient of recipients) {
          try {
            await dbRetry(() => prisma.notification.create({
              data: {
                userId: recipient.id,
                type: "SYSTEM",
                title: schedule.title,
                message: schedule.message,
                entityId: occurrenceId,
                priority: schedule.highPriority ? "HIGH" : "NORMAL",
              },
            }));
            if (schedule.highPriority && recipient.chatId) {
              await bot.api.sendMessage(recipient.chatId, telegramMessage, { parse_mode: "HTML" });
            }
          } catch (error) {
            errors.push(`recipient ${recipient.id}: ${(error as Error).message}`);
          }
        }
      }

      if (schedule.sendTelegram) {
        const groupId = process.env.TG_DONATION_GROUP_ID || process.env.TG_GROUP_ID || "";
        const topicId = process.env.TG_DONATION_TOPIC_ID || "";
        if (!groupId) {
          errors.push("Telegram group is not configured");
        } else {
          try {
            await bot.api.sendMessage(groupId, telegramMessage, {
              parse_mode: "HTML",
              ...(topicId ? { message_thread_id: Number(topicId) } : {}),
            });
          } catch (error) {
            errors.push(`Telegram group: ${(error as Error).message}`);
          }
        }
      }

      await dbRetry(() => prisma.auditLog.create({
        data: {
          userId: schedule.createdById,
          action: "BROADCAST_REPEAT_SENT",
          entityType: "ScheduledBroadcast",
          entityId: schedule.id,
          after: {
            scheduledFor: scheduledFor.toISOString(),
            nextFire: next.toISOString(),
            recipientCount: recipients.length,
            errors,
          },
        },
      }));
      if (errors.length > 0) {
        await dbRetry(() => prisma.scheduledBroadcast.update({
          where: { id: schedule.id },
          data: { lastError: errors.slice(0, 5).join(" | ").slice(0, 2000) },
        }));
      }
      console.log(`[broadcast-repeat] Sent ${schedule.id}; next=${next.toISOString()}; errors=${errors.length}`);
    }
  } catch (err) {
    console.error("[broadcast-repeat] Check failed:", err);
  }
}

async function backfillServiceOperations() {
  try {
    const admin = await dbRetry(() => prisma.user.findFirst({
      where: { roles: { has: "ADMIN" }, status: "ACTIVE" },
      select: { id: true },
    }));
    if (!admin) return;
    const services = await dbRetry(() => prisma.service.findMany({
      where: { OR: [{ paidTxId: { not: null } }, { expiryDate: { not: null } }] },
      include: { reminders: { where: { active: true }, select: { id: true } } },
    }));
    let links = 0;
    let reminders = 0;
    for (const service of services) {
      if (service.paidTxId) {
        const paidTxId = service.paidTxId;
        const linked = await dbRetry(() => prisma.transaction.updateMany({
          where: { id: paidTxId, serviceId: null },
          data: { serviceId: service.id },
        }));
        links += linked.count;
      }
      const repeat = serviceReminderRepeat(service.frequency);
      if (service.status === "ACTIVE" && service.expiryDate && repeat && service.reminders.length === 0) {
        await dbRetry(() => prisma.reminder.create({
          data: {
            createdById: admin.id,
            message: `Renew ${service.name}${service.price ? ` (${service.currency} ${service.price})` : ""}`,
            frequency: "CUSTOM",
            repeatEvery: repeat.repeatEvery,
            repeatUnit: repeat.repeatUnit,
            nextFire: service.expiryDate!,
            channel: "BOTH",
            recipientRoles: ["ADMIN"],
            serviceId: service.id,
          },
        }));
        reminders += 1;
      }
    }
    console.log(`[service-backfill] Linked payments=${links}; reminders=${reminders}`);
  } catch (error) {
    console.error("[service-backfill] Failed:", error);
  }
}

// ── Per-user rate limiting ──────────────────────────────────────────────
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT = 5; // max commands
const RATE_WINDOW = 60_000; // per 60 seconds

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) return next();

  const key = userId.toString();
  const now = Date.now();
  const timestamps = (rateLimitMap.get(key) || []).filter(
    (t) => now - t < RATE_WINDOW,
  );

  if (timestamps.length >= RATE_LIMIT) {
    await ctx.reply(
      `<blockquote><b>⏳ Slow down</b></blockquote>\n` +
        `<i>You're sending commands too fast. Please wait a moment before trying again.</i>`,
      { parse_mode: "HTML" },
    );
    return;
  }

  timestamps.push(now);
  rateLimitMap.set(key, timestamps);
  return next();
});

// Periodic cleanup to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of rateLimitMap.entries()) {
    const valid = timestamps.filter((t) => now - t < RATE_WINDOW);
    if (valid.length === 0) rateLimitMap.delete(key);
    else rateLimitMap.set(key, valid);
  }
}, 5 * 60 * 1000);

bot.command("start", async (ctx) => {
  const telegramId = ctx.from?.id.toString();
  const chatId = ctx.chat.id.toString();
  const username = ctx.from?.username || "";
  const firstName = ctx.from?.first_name || "Unknown";

  if (!telegramId) return;

  // Deep link: /start myid — reply with the user's Telegram ID
  const payload = ctx.match?.trim();
  if (payload === "myid") {
    try {
      await ctx.reply(
        `<blockquote><b>🆔 Your Telegram ID</b></blockquote>\n` +
        `<code>${telegramId}</code>\n\n` +
        `<i>Copy and paste it on the login page.</i>`,
        { parse_mode: "HTML" },
      );
    } catch (err) {
      console.error("Failed to reply with user ID:", err);
    }
    return;
  }

  // Claim a one-time checkout through Telegram before revealing its payment URL.
  if (payload && payload.startsWith("donate_")) {
    const token = payload.slice(7);
    if (!INVITE_TOKEN_PATTERN.test(token)) {
      await ctx.reply("❌ This payment invitation is invalid. Ask the administrator for a new link.");
      return;
    }

    try {
      const now = new Date();
      let invite = await dbRetry(() => prisma.oneTimeDonationInvite.findUnique({
        where: { tokenHash: hashInviteToken(token) },
      }));

      if (!invite) {
        await ctx.reply("❌ This payment invitation was not found.");
        return;
      }
      if (invite.revokedAt) {
        await ctx.reply("⛔ This payment invitation was revoked by an administrator.");
        return;
      }
      if (invite.usedAt) {
        await ctx.reply("✅ This one-time payment invitation has already been used.");
        return;
      }
      if (invite.expiresAt <= now) {
        await ctx.reply("⌛ This payment invitation has expired. Ask the administrator for a new link.");
        return;
      }
      if (invite.telegramId && invite.telegramId !== telegramId) {
        await ctx.reply("🔒 This payment invitation has already been claimed by another Telegram account.");
        return;
      }

      let claimedNow = false;
      if (!invite.telegramId) {
        const claimed = await dbRetry(() => prisma.oneTimeDonationInvite.updateMany({
          where: {
            id: invite!.id,
            telegramId: null,
            revokedAt: null,
            usedAt: null,
            expiresAt: { gt: now },
          },
          data: {
            telegramId,
            telegramUser: username || null,
            claimedAt: now,
          },
        }));
        claimedNow = claimed.count === 1;
        invite = await dbRetry(() => prisma.oneTimeDonationInvite.findUnique({
          where: { id: invite!.id },
        }));
      } else if (username && username !== invite.telegramUser) {
        invite = await dbRetry(() => prisma.oneTimeDonationInvite.update({
          where: { id: invite!.id },
          data: { telegramUser: username, claimedAt: invite!.claimedAt || now },
        }));
      }

      if (!invite || invite.telegramId !== telegramId) {
        await ctx.reply("🔒 This payment invitation was claimed by another Telegram account.");
        return;
      }

      if (claimedNow) {
        await dbRetry(() => prisma.auditLog.create({
          data: {
            userId: invite!.createdById,
            action: "PAYMENT_INVITE_CLAIM",
            entityType: "OneTimeDonationInvite",
            entityId: invite!.id,
            after: {
              telegramId,
              telegramUser: username || null,
              claimedAt: now.toISOString(),
            },
          },
        }));
        await logAuditEvent({
          action: "PAYMENT_INVITE_CLAIM",
          entityType: "OneTimeDonationInvite",
          entityId: invite.id,
          userName: firstName,
          details: `${username ? `@${username} · ` : ""}TG ${telegramId} verified through the bot`,
        });
      }

      const webappUrl = (process.env.WEBAPP_URL || "https://pzp.finance").replace(/\/$/, "");
      const paymentUrl = `${webappUrl}/donate/${token}`;
      await ctx.reply(
        `<blockquote><b>✅ Telegram identity verified</b></blockquote>\n` +
        `<b>${escapeBotHtml(invite.guestName)}</b>\n` +
        `${username ? `@${username} · ` : ""}<code>${telegramId}</code>\n\n` +
        `<i>This payment invitation is tied to your Telegram account and its expiry.</i>`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[
              { text: "Continue to payment options", web_app: { url: paymentUrl } },
            ]],
          },
        },
      );
    } catch (err) {
      console.error("Failed to claim one-time payment invitation:", err);
      await ctx.reply("❌ Something went wrong while verifying this payment invitation. Please try again.");
    }
    return;
  }

  // Deep link: /start auth_{nonce} — verify login from web
  if (payload && payload.startsWith("auth_")) {
    const nonce = payload.slice(5); // strip "auth_"
    if (!nonce || nonce.length < 16) {
      try {
        await ctx.reply(
          `❌ <i>Invalid login link. Please try again from the website.</i>`,
          { parse_mode: "HTML" },
        );
      } catch (err) {
        console.error("Failed to reply for invalid nonce:", err);
      }
      return;
    }

    try {
      const loginToken = await dbRetry(() =>
        prisma.loginToken.findUnique({ where: { nonce } }),
      );

      if (!loginToken || loginToken.status !== "PENDING") {
        await ctx.reply(
          `⏳ <i>This login link has already been used or expired. Please request a new one.</i>`,
          { parse_mode: "HTML" },
        );
        return;
      }

      if (loginToken.expiresAt < new Date()) {
        await ctx.reply(
          `⏳ <i>This login link has expired. Please request a new one from the website.</i>`,
          { parse_mode: "HTML" },
        );
        return;
      }

      // Ensure user exists in DB, create if needed
      let authUser = await dbRetry(() =>
        prisma.user.findUnique({ where: { telegramId } }),
      );

      if (!authUser) {
        // Fetch profile photo before creating user
        const photoUrl = await fetchTelegramPhotoUrl(telegramId, firstName, bot);

        authUser = await dbRetry(() =>
          prisma.user.create({
            data: {
              telegramId,
              telegramUser: username,
              name: firstName,
              chatId,
              photoUrl,
              roles: [],
            },
          }),
        );

        logAuditEvent({
          action: "BOT_REGISTER",
          entityType: "User",
          entityId: authUser.id,
          userName: firstName,
          details: `@${username || telegramId} registered via web login`,
        });

        await notifyAdminsFromBot(prisma, bot, {
          type: "USER_REGISTERED",
          title: "New User Started Bot",
          message: `${firstName} (@${username || telegramId}) registered via web login and is awaiting role assignment.`,
          entityId: authUser.id,
          priority: "HIGH",
          telegramMessage:
            `<blockquote><b>🆕 New User Started Bot</b></blockquote>\n` +
            `<b>${firstName}</b> (@${username || telegramId})\n` +
            `<i>Registered via web login — awaiting role assignment</i>`,
        });
      } else {
        // Update chatId + refresh profile photo
        const photoUrl = await fetchTelegramPhotoUrl(telegramId, firstName, bot);
        const updates: Record<string, string | null> = {};
        if (!authUser.chatId || authUser.chatId !== chatId) updates.chatId = chatId;
        if (photoUrl) updates.photoUrl = photoUrl;

        if (Object.keys(updates).length > 0) {
          await dbRetry(() =>
            prisma.user.update({
              where: { id: authUser!.id },
              data: updates,
            }),
          );
        }
      }

      // Mark token as verified
      await dbRetry(() =>
        prisma.loginToken.update({
          where: { nonce },
          data: { telegramId, status: "VERIFIED" },
        }),
      );

      // Send confirmation with inline button
      const webappUrl = process.env.WEBAPP_URL || "https://pzp.finance";
      await ctx.reply(
        `<blockquote><b>✅ Login Verified</b></blockquote>\n` +
        `<b>${authUser.name}</b>, you've been signed in on the web.\n\n` +
        `<i>You can close this chat and return to Sentinel.</i>`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "Open Sentinel", web_app: { url: webappUrl } }],
            ],
          },
        },
      );

      logAuditEvent({
        action: "WEB_LOGIN",
        entityType: "User",
        entityId: authUser.id,
        userName: authUser.name,
        details: `@${authUser.telegramUser || telegramId} verified web login via bot`,
      });
    } catch (err) {
      console.error("Failed to process auth deep link:", err);
      try {
        await ctx.reply(
          `❌ <i>Something went wrong verifying your login. Please try again.</i>`,
          { parse_mode: "HTML" },
        );
      } catch { /* swallow */ }
    }
    return;
  }

  const user = await dbRetry(() => prisma.user.findUnique({ where: { telegramId } }));

  // Always refresh profile photo on /start
  const photoUrl = await fetchTelegramPhotoUrl(telegramId, firstName, bot);

  if (user) {
    const updates: Record<string, string | null> = { chatId };
    if (photoUrl) updates.photoUrl = photoUrl;
    // Refresh the @username if it changed (telegramId is the stable key).
    // Leave `name` alone so a user's edited profile name isn't clobbered.
    if (username && username !== user.telegramUser) updates.telegramUser = username;
    await dbRetry(() => prisma.user.update({
      where: { id: user!.id },
      data: updates,
    }));
  }

  const webappUrl = process.env.WEBAPP_URL || "https://pzp.finance";

  if (!user) {
    const created = await dbRetry(() => prisma.user.create({
      data: {
        telegramId,
        telegramUser: username,
        name: firstName,
        chatId,
        photoUrl,
        roles: [],
      },
    }));

    logAuditEvent({
      action: "BOT_REGISTER",
      entityType: "User",
      entityId: created.id,
      userName: firstName,
      details: `@${username || telegramId} started the bot — awaiting role assignment`,
    });

    // Notify all admins — in-app + Telegram DM
    await notifyAdminsFromBot(prisma, bot, {
      type: "USER_REGISTERED",
      title: "New User Started Bot",
      message: `${firstName} (@${username || telegramId}) started the bot and is awaiting role assignment.`,
      entityId: created.id,
      priority: "HIGH",
      telegramMessage:
        `<blockquote><b>🆕 New User Started Bot</b></blockquote>\n` +
        `<b>${firstName}</b> (@${username || telegramId})\n` +
        `<i>Awaiting role assignment</i>`,
    });

    try {
      await ctx.reply(
        `<blockquote><b>🎉 Welcome to Sentinel</b></blockquote>\n` +
        `<b>Hey ${firstName}!</b>\n\n` +
        `💰 Tracks community treasury\n` +
        `📋 Manages developer tasks & boards\n` +
        `🔔 Sends payment reminders & notifications\n` +
        `📊 Keeps everything transparent\n\n` +
        `<i>You're not registered yet. An admin will review and assign your access shortly.</i>`,
        { parse_mode: "HTML" },
      );
    } catch (err) {
      console.error("Failed to reply to new user:", err);
    }
    return;
  }

  if (user.status === "INACTIVE") {
    try {
      await ctx.reply(
        `<blockquote><b>🚫 Account Deactivated</b></blockquote>\n` +
        `<b>Hey ${user.name},</b>\n` +
        `<i>Your account has been deactivated. Contact an admin if you think this is a mistake.</i>`,
        { parse_mode: "HTML" },
      );
    } catch (err) {
      console.error("Failed to reply to deactivated user:", err);
    }
    return;
  }

  if (user.roles.length === 0) {
    try {
      await ctx.reply(
        `<blockquote><b>⏳ Pending Approval</b></blockquote>\n` +
        `<b>Hey ${user.name}!</b>\n` +
        `<i>You're in the system but don't have access yet. An admin will assign your role shortly.</i>`,
        { parse_mode: "HTML" },
      );
    } catch (err) {
      console.error("Failed to reply to unassigned user:", err);
    }
    return;
  }

  const roleLabels: Record<string, string> = {
    ADMIN: "🛡️ <b>Admin</b> — full treasury control",
    DONOR: "💚 <b>Donor</b> — submit & track donations",
    DEV: "⚡ <b>Dev</b> — project board & tasks",
  };

  const yourRoles = user.roles
    .map((r) => roleLabels[r] || r)
    .join("\n");
  const donorWebsite = user.roles.includes("DONOR")
    ? `\n\nYou can also use Sentinel directly at <a href="https://sentinel.piratezparty.com">sentinel.piratezparty.com</a>.`
    : "";

  try {
    await ctx.reply(
      `<b><i>👋 Welcome back, ${user.name}!</i></b>\n\n` +
      `<blockquote><b>Your Access</b></blockquote>\n` +
      `${yourRoles}${donorWebsite}`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "Open Sentinel", web_app: { url: webappUrl } }],
          ],
        },
      }
    );
  } catch (err) {
    console.error("Failed to reply to returning user:", err);
  }
});

// Detect bot blocked/unblocked — update chatId in real time
bot.on("my_chat_member", async (ctx) => {
  const update = ctx.myChatMember;
  if (!update || update.chat.type !== "private") return;

  const telegramId = update.from.id.toString();
  const newStatus = update.new_chat_member.status; // "kicked" = blocked, "member" = unblocked

  try {
    const user = await dbRetry(() => prisma.user.findUnique({ where: { telegramId } }));
    if (!user) return;

    if (newStatus === "kicked") {
      await dbRetry(() => prisma.user.update({ where: { id: user!.id }, data: { chatId: null } }));
      console.warn(`Bot blocked by ${user.name} (@${user.telegramUser}) — chatId cleared`);
    } else if (newStatus === "member") {
      await dbRetry(() => prisma.user.update({
        where: { id: user!.id },
        data: { chatId: update.chat.id.toString() },
      }));
      console.info(`Bot unblocked by ${user.name} (@${user.telegramUser}) — chatId restored`);
    }
  } catch (err) {
    console.error("Failed to handle my_chat_member update:", err);
  }
});

bot.command("help", async (ctx) => {
  try {
    await ctx.reply(
      `<blockquote><b>📖 Sentinel Commands</b></blockquote>\n` +
      `<b>/start</b> — register or open the web app\n` +
      `<b>/start myid</b> — get your Telegram ID\n` +
      `<b>/help</b> — show this message`,
      { parse_mode: "HTML" },
    );
  } catch (err) {
    console.error("Failed to reply with help:", err);
  }
});

registerRazorpayFeedbackHandlers(bot, prisma);
registerBmcFeedbackHandlers(bot, prisma);

bot.catch((err) => {
  console.error("Bot error:", err);
});

// ── Service expiry checker ─────────────────────────────────────────────
const EXPIRY_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

async function createOperationalAlert(params: {
  fingerprint: string;
  kind: string;
  severity: string;
  title: string;
  message: string;
  dueAt?: Date | null;
  serviceId?: string;
  credentialId?: string;
  vpsServerId?: string;
}) {
  const existing = await dbRetry(() => prisma.operationalAlert.findUnique({ where: { fingerprint: params.fingerprint } }));
  if (existing) return false;
  await dbRetry(() => prisma.operationalAlert.create({ data: params }));
  await notifyAdminsFromBot(prisma, bot, {
    type: "SYSTEM",
    title: params.title,
    message: params.message,
    entityId: params.serviceId ?? params.credentialId ?? params.vpsServerId,
    priority: params.severity,
    telegramMessage: `<blockquote><b>⚠️ ${escapeBotHtml(params.title)}</b></blockquote>\n${escapeBotHtml(params.message)}`,
  });
  return true;
}

async function checkVpsAvailability() {
  try {
    const cutoff = new Date(Date.now() - 120_000);
    const servers = await dbRetry(() => prisma.vpsServer.findMany({
      where: { approved: true },
      select: { id: true, name: true, lastSeen: true, alertsEnabled: true },
    }));
    for (const server of servers) {
      const fingerprint = `vps:${server.id}:VPS_OFFLINE`;
      const existing = await dbRetry(() => prisma.operationalAlert.findUnique({ where: { fingerprint } }));
      if (!server.alertsEnabled) {
        if (existing?.status === "OPEN") await dbRetry(() => prisma.operationalAlert.update({ where: { id: existing.id }, data: { status: "RESOLVED", resolvedAt: new Date() } }));
        continue;
      }
      const offline = server.lastSeen < cutoff;
      if (!offline) {
        if (existing?.status === "OPEN") await dbRetry(() => prisma.operationalAlert.update({ where: { id: existing.id }, data: { status: "RESOLVED", resolvedAt: new Date() } }));
        continue;
      }
      const shouldNotify = !existing || existing.status !== "OPEN";
      await dbRetry(() => prisma.operationalAlert.upsert({
        where: { fingerprint },
        create: { fingerprint, kind: "VPS_OFFLINE", severity: "HIGH", title: `${server.name} is offline`, message: `No heartbeat since ${server.lastSeen.toISOString()}.`, vpsServerId: server.id },
        update: { status: "OPEN", resolvedAt: null, title: `${server.name} is offline`, message: `No heartbeat since ${server.lastSeen.toISOString()}.` },
      }));
      if (shouldNotify) await notifyVpsAlertSubscribers({
        vpsServerId: server.id,
        kind: "VPS_OFFLINE",
        title: `${server.name} is offline`,
        message: `No heartbeat since ${server.lastSeen.toLocaleString()}.`,
      });
    }
  } catch (error) {
    console.error("[vps-alert] Availability check failed:", error);
  }
}

async function checkServiceExpiry() {
  console.log("[expiry] Running service expiry check...");
  try {
    const now = new Date();
    const in1Day = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
    const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const overdue = await dbRetry(() => prisma.service.findMany({
      where: { status: "ACTIVE", autoRenew: false, expiryDate: { lte: now, not: null } },
    }));
    for (const service of overdue) {
      await createOperationalAlert({
        fingerprint: `service-overdue:${service.id}:${service.expiryDate!.toISOString()}`,
        kind: "OVERDUE_PAYMENT",
        severity: "HIGH",
        title: `Renewal overdue: ${service.name}`,
        message: `${service.name} passed its renewal date on ${service.expiryDate!.toLocaleDateString()}. Confirm payment, renewal or cancellation.`,
        dueAt: service.expiryDate,
        serviceId: service.id,
      });
    }

    // Auto-expire services past their date
    const expired = await dbRetry(() =>
      prisma.service.updateMany({
        where: { status: "ACTIVE", autoRenew: false, expiryDate: { lte: now, not: null } },
        data: { status: "EXPIRED" },
      }),
    );
    if (expired.count > 0) {
      console.log(`[expiry] Auto-expired ${expired.count} service(s)`);
    }

    // Find services expiring within 7 days
    const expiring = await dbRetry(() =>
      prisma.service.findMany({
        where: {
          status: "ACTIVE",
          expiryDate: { not: null, lte: in7Days, gt: now },
        },
        orderBy: { expiryDate: "asc" },
      }),
    );

    if (expiring.length === 0) {
      console.log("[expiry] No services expiring soon.");
    }

    for (const svc of expiring) {
      const expiryDate = svc.expiryDate!;
      const daysLeft = Math.ceil((expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      const dateStr = expiryDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const daysLabel = daysLeft === 1 ? "1 day" : `${daysLeft} days`;

      let emoji: string, heading: string, priority: string;
      if (expiryDate <= in1Day) {
        emoji = "🔴"; heading = "Service Expiring Tomorrow"; priority = "HIGH";
      } else if (expiryDate <= in3Days) {
        emoji = "🟡"; heading = "Service Expiring Soon"; priority = "NORMAL";
      } else {
        emoji = "📋"; heading = "Service Expiry Reminder"; priority = "LOW";
      }

      let priceDetail = "";
      if (svc.price != null && svc.currency && svc.frequency) {
        priceDetail = `\nPrice: ${svc.currency} ${svc.price}/${svc.frequency.toLowerCase()}`;
      }

      const bucket = daysLeft <= 1 ? 1 : daysLeft <= 3 ? 3 : 7;
      await createOperationalAlert({
        fingerprint: `renewal-upcoming:${svc.id}:${expiryDate.toISOString()}:${bucket}`,
        kind: "UPCOMING_RENEWAL",
        severity: priority,
        title: `${emoji} ${heading}: ${svc.name}`,
        message: `${svc.name} expires in ${daysLabel} (${dateStr}). Renew or update the service.${priceDetail}`,
        dueAt: expiryDate,
        serviceId: svc.id,
      });

      console.log(`[expiry] Alerted: ${svc.name} — ${daysLabel} left`);
    }

    console.log(`[expiry] Done. ${expiring.length} alert(s) sent.`);

    const credentialHorizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const credentials = await dbRetry(() => prisma.credential.findMany({
      where: { parentId: null, status: "APPROVED", expiresAt: { not: null, lte: credentialHorizon } },
      select: { id: true, platform: true, label: true, expiresAt: true, serviceId: true },
    }));
    for (const credential of credentials) {
      const days = Math.ceil((credential.expiresAt!.getTime() - now.getTime()) / 86_400_000);
      const bucket = days <= 0 ? "overdue" : days <= 1 ? "1" : days <= 7 ? "7" : "30";
      await createOperationalAlert({
        fingerprint: `credential-expiry:${credential.id}:${credential.expiresAt!.toISOString()}:${bucket}`,
        kind: "CREDENTIAL_EXPIRY",
        severity: days <= 1 ? "HIGH" : "NORMAL",
        title: `Credential ${days <= 0 ? "expired" : "expiring"}: ${credential.label}`,
        message: `${credential.platform} · ${credential.label} ${days <= 0 ? "has expired" : `expires in ${days} day${days === 1 ? "" : "s"}`}. Rotate or renew it in the credential vault.`,
        dueAt: credential.expiresAt,
        credentialId: credential.id,
        serviceId: credential.serviceId ?? undefined,
      });
    }
  } catch (err) {
    console.error("[expiry] Check failed:", err);
  }
}

// ── Donor donate-reminders ─────────────────────────────────────────────
// 30-min poll so the donor's chosen time-of-day is honored within ~30 min.
const DONATE_REMINDER_CHECK_INTERVAL = 30 * 60 * 1000;

async function checkDonateReminders() {
  console.log("[donate-reminder] Running donor reminder check...");
  try {
    const now = new Date();
    const donors = await dbRetry(() =>
      prisma.user.findMany({
        where: {
          roles: { has: "DONOR" },
          status: "ACTIVE",
          donateReminderCadence: { not: "OFF" },
          chatId: { not: null },
        },
        select: {
          id: true,
          name: true,
          chatId: true,
          donateReminderCadence: true,
          lastDonateReminderAt: true,
          donateReminderAnchorAt: true,
          donateReminderEveryN: true,
          donateReminderUnit: true,
          donateReminderTimeMin: true,
          donateReminderTz: true,
          telegramUser: true,
        },
      }),
    );

    let sent = 0;
    for (const d of donors) {
      if (!reminderDue(d, now)) continue;
      if (!d.chatId) continue;
      const isFirst = !d.lastDonateReminderAt;
      try {
        await bot.api.sendMessage(d.chatId, donateReminderMessage(d.name, isFirst), { parse_mode: "HTML" });
        if (d.donateReminderCadence === "MONTHLY" && d.donateReminderAnchorAt) {
          await postDonationThanks(monthlyDonationReminderGroupMessage(donorHandle(d.name, d.telegramUser)));
        }
        sent++;
      } catch (e) {
        console.error(`[donate-reminder] DM failed for ${d.id}:`, (e as Error).message);
      }
      // Stamp so the next nudge waits for the next cadence window.
      await dbRetry(() =>
        prisma.user.update({ where: { id: d.id }, data: { lastDonateReminderAt: now } }),
      ).catch(() => {});
    }
    console.log(`[donate-reminder] Done. ${sent} reminder(s) sent of ${donors.length} eligible donor(s).`);
  } catch (err) {
    console.error("[donate-reminder] Check failed:", err);
  }
}

// ── VPS subscription auto-renewals ─────────────────────────────────────
const SUB_RENEWAL_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // daily

// Auto-renewing VPS subscriptions create a PENDING expense. An admin must approve
// it before the expense counts and the service billing cycle advances.
async function checkSubscriptionRenewals() {
  console.log("[sub-renewal] Running subscription auto-renewal check...");
  try {
    const now = new Date();
    const admin = await dbRetry(() =>
      prisma.user.findFirst({
        where: { roles: { has: "ADMIN" }, status: "ACTIVE" },
        select: { id: true },
      }),
    );
    if (!admin) {
      console.warn("[sub-renewal] No active admin for attribution — skipping.");
      return;
    }

    const due = await dbRetry(() =>
      prisma.service.findMany({
        where: {
          autoRenew: true,
          status: "ACTIVE",
          frequency: { in: ["WEEKLY", "MONTHLY", "YEARLY"] },
          price: { not: null },
          expiryDate: { not: null, lte: now },
        },
        select: { id: true, name: true, price: true, currency: true, frequency: true, expiryDate: true },
      }),
    );

    let requested = 0;
    for (const sub of due) {
      const price = sub.price != null ? Number(sub.price) : 0;
      if (!(price > 0)) continue;
      try {
        const pending = await dbRetry(() => prisma.transaction.findFirst({
          where: {
            serviceId: sub.id,
            isAutomatedRenewal: true,
            status: "PENDING",
            voidedAt: null,
          },
          select: { id: true },
        }));
        if (pending) continue;
        const tx = await dbRetry(() =>
          prisma.transaction.create({
            data: {
              amount: new Prisma.Decimal(price),
              currency: sub.currency ?? "INR",
              method: "OTHER",
              direction: "OUT",
              type: "SUBSCRIPTION",
              description: `VPS plan renewal approval: ${sub.name}`,
              status: "PENDING",
              date: now,
              createdById: admin.id,
              serviceId: sub.id,
              isAutomatedRenewal: true,
              automatedRenewalKey: `${sub.id}:${sub.expiryDate!.toISOString()}`,
            },
          }),
        );
        const currency = sub.currency ?? "INR";
        await notifyAdminsFromBot(prisma, bot, {
          type: "TX_PENDING",
          title: "Subscription renewal needs approval",
          message: `${sub.name} is due for ${currency} ${price}. Approve the pending transaction to deduct it and advance the billing cycle.`,
          entityId: tx.id,
          priority: "HIGH",
          telegramMessage:
            `<blockquote><b>Subscription renewal needs approval</b></blockquote>\n` +
            `<b>${escapeBotHtml(sub.name)}</b> is due for <b>${currency} ${price}</b>.\n` +
            `Open Sentinel Transactions to approve or reject it.`,
        });
        requested++;
      } catch (e) {
        console.error(`[sub-renewal] Renewal failed for ${sub.id}:`, (e as Error).message);
      }
    }
    console.log(`[sub-renewal] Done. ${requested} approval request(s) created of ${due.length} due.`);
  } catch (err) {
    console.error("[sub-renewal] Check failed:", err);
  }
}

(async () => {
  await prepareTelegramPolling();
  console.log("Sentinel bot starting in polling mode...");
  bot.start({
    onStart: () => {
      console.log("Sentinel bot is live! Send /start to @" + process.env.BOT_USERNAME);

      // Run first expiry check after 10s (let DB connections warm up), then every 24h
      setTimeout(() => {
        checkServiceExpiry();
        setInterval(checkServiceExpiry, EXPIRY_CHECK_INTERVAL);
      }, 10_000);
      console.log("[expiry] Scheduled — first check in 10s, then every 24h");

      // Donor donate-reminders: first check after 20s, then every 6h
      setTimeout(() => {
        checkDonateReminders();
        setInterval(checkDonateReminders, DONATE_REMINDER_CHECK_INTERVAL);
      }, 20_000);
      console.log("[donate-reminder] Scheduled — first check in 20s, then every 6h");

      // VPS subscription auto-renewals: first check after 30s, then every 24h
      setTimeout(() => {
        checkSubscriptionRenewals();
        setInterval(checkSubscriptionRenewals, SUB_RENEWAL_CHECK_INTERVAL);
      }, 30_000);
      // Admin reminders and repeating broadcasts are separate queues.
      setTimeout(() => {
        checkAdminReminders();
        checkScheduledBroadcasts();
        checkVpsAvailability();
        drainFinanceAutomationQueue();
        setInterval(checkAdminReminders, ADMIN_MESSAGE_CHECK_INTERVAL);
        setInterval(checkScheduledBroadcasts, ADMIN_MESSAGE_CHECK_INTERVAL);
        setInterval(checkVpsAvailability, ADMIN_MESSAGE_CHECK_INTERVAL);
        setInterval(drainFinanceAutomationQueue, ADMIN_MESSAGE_CHECK_INTERVAL);
      }, 40_000);
      console.log("[admin-messages] Scheduled — first check in 40s, then every minute");
      setTimeout(() => {
        reconcileProviderPayments();
        setInterval(reconcileProviderPayments, PROVIDER_RECONCILIATION_INTERVAL);
      }, 45_000);
      console.log("[provider-reconcile] Razorpay safety sync starts in 45s, then every 6h");
      setTimeout(backfillServiceOperations, 55_000);
      console.log("[service-backfill] Existing service links/reminders will be checked in 55s");
      console.log("[sub-renewal] Scheduled — first check in 30s, then every 24h");
    },
  });
})();
