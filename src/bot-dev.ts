import "dotenv/config";
import { Bot } from "grammy";
import { PrismaClient, Prisma } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { logAuditEvent } from "./lib/telegram-log";
import { donateReminderMessage } from "./lib/donation-thanks";
import { scheduleFinanceAutomation } from "./lib/finance-sheets";

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
  },
) {
  try {
    const admins = await dbRetry(() =>
      db.user.findMany({
        where: { roles: { has: "ADMIN" }, status: "ACTIVE" },
        select: { id: true, chatId: true, dmPreferences: true },
      }),
    );

    console.log(`[notifyAdmins] Found ${admins.length} admin(s) to notify for ${data.type}`);

    for (const admin of admins) {
      // In-app notification
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

      // Telegram DM
      if (admin.chatId && data.telegramMessage) {
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

/**
 * Fetch user's profile photo via the bot API (bypasses privacy settings),
 * upload it to the TG group for permanent storage, and return a proxy URL.
 */
async function fetchAndSaveProfilePhoto(
  botInstance: typeof bot,
  telegramId: string,
  userName?: string,
): Promise<string | null> {
  const groupId = process.env.TG_GROUP_ID;
  const topicId = process.env.TG_TOPIC_SCREENSHOTS;

  try {
    const photos = await botInstance.api.getUserProfilePhotos(parseInt(telegramId), { limit: 1 });
    if (photos.total_count === 0) return null;

    const photo = photos.photos[0];
    const bestSize = photo[photo.length - 1]; // largest available
    const fileId = bestSize.file_id;

    // Upload to TG group for permanent storage
    if (groupId && topicId) {
      try {
        await botInstance.api.sendPhoto(groupId, fileId, {
          message_thread_id: parseInt(topicId),
          caption: `📸 Avatar: ${userName || telegramId}`,
        });
      } catch (err) {
        console.error(`[avatar] Failed to upload to TG group:`, err);
      }
    }

    // Return proxy URL — the API route will fetch from TG on demand
    return `/api/avatar/${fileId}`;
  } catch (err) {
    console.error(`Failed to fetch profile photo for ${telegramId}:`, err);
    return null;
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
        const photoUrl = await fetchAndSaveProfilePhoto(bot, telegramId, firstName);

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
        const photoUrl = await fetchAndSaveProfilePhoto(bot, telegramId, firstName);
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
  const photoUrl = await fetchAndSaveProfilePhoto(bot, telegramId, firstName);

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

  try {
    await ctx.reply(
      `<b><i>👋 Welcome back, ${user.name}!</i></b>\n\n` +
      `<blockquote><b>Your Access</b></blockquote>\n` +
      `${yourRoles}`,
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


bot.catch((err) => {
  console.error("Bot error:", err);
});

// ── Service expiry checker ─────────────────────────────────────────────
const EXPIRY_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

async function checkServiceExpiry() {
  console.log("[expiry] Running service expiry check...");
  try {
    const now = new Date();
    const in1Day = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
    const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Auto-expire services past their date
    const expired = await dbRetry(() =>
      prisma.service.updateMany({
        where: { status: "ACTIVE", expiryDate: { lte: now, not: null } },
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
      return;
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

      await notifyAdminsFromBot(prisma, bot, {
        type: "SYSTEM",
        title: `Service Expiring: ${svc.name}`,
        message: `${svc.name} expires in ${daysLabel} (${dateStr}). Renew or update the service.`,
        entityId: svc.id,
        priority,
        telegramMessage:
          `<blockquote><b>${emoji} ${heading}</b></blockquote>\n` +
          `<b>${svc.name}</b> (${svc.category})\n` +
          `Expires: ${dateStr} (${daysLabel} left)${priceDetail}`,
      });

      console.log(`[expiry] Alerted: ${svc.name} — ${daysLabel} left`);
    }

    console.log(`[expiry] Done. ${expiring.length} alert(s) sent.`);
  } catch (err) {
    console.error("[expiry] Check failed:", err);
  }
}

// ── Donor donate-reminders ─────────────────────────────────────────────
// 30-min poll so the donor's chosen time-of-day is honored within ~30 min.
const DONATE_REMINDER_CHECK_INTERVAL = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type ReminderDonor = {
  donateReminderCadence: string;
  lastDonateReminderAt: Date | null;
  donateReminderEveryN: number | null;
  donateReminderUnit: string | null;
  donateReminderTimeMin: number;
  donateReminderTz: string;
};

// {year, month(1-12), day, hour, minute} of `date` in the given IANA timezone.
// Falls back to UTC if the zone is somehow invalid.
function localParts(date: Date, tz: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    let hour = get("hour");
    if (hour === 24) hour = 0; // some ICU builds emit 24 at midnight
    return { year: get("year"), month: get("month"), day: get("day"), hour, minute: get("minute") };
  } catch {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
    };
  }
}

// A reminder fires only once the donor's local time-of-day has been reached, AND
// the cadence interval has elapsed. Weekly/biweekly/custom-day/week roll from the
// last reminder; monthly fires on/after the 5th once per local calendar month;
// custom-month advances by whole local calendar months.
function reminderDue(d: ReminderDonor, now: Date): boolean {
  const tz = d.donateReminderTz || "Asia/Kolkata";
  const nowL = localParts(now, tz);
  const timeReached = nowL.hour * 60 + nowL.minute >= (d.donateReminderTimeMin ?? 540);
  if (!timeReached) return false;

  const last = d.lastDonateReminderAt;
  const cadence = d.donateReminderCadence;

  if (cadence === "WEEKLY") return !last || now.getTime() - last.getTime() >= 7 * DAY_MS;
  if (cadence === "BIWEEKLY") return !last || now.getTime() - last.getTime() >= 14 * DAY_MS;
  if (cadence === "MONTHLY") {
    if (nowL.day < 5) return false;
    if (!last) return true;
    const lastL = localParts(last, tz);
    return lastL.year !== nowL.year || lastL.month !== nowL.month;
  }
  if (cadence === "CUSTOM") {
    if (!last) return true;
    const n = d.donateReminderEveryN ?? 1;
    const unit = d.donateReminderUnit ?? "WEEK";
    if (unit === "DAY") return now.getTime() - last.getTime() >= n * DAY_MS;
    if (unit === "WEEK") return now.getTime() - last.getTime() >= n * 7 * DAY_MS;
    if (unit === "MONTH") {
      const lastL = localParts(last, tz);
      const monthsElapsed = (nowL.year - lastL.year) * 12 + (nowL.month - lastL.month);
      return monthsElapsed >= n;
    }
  }
  return false;
}

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
          donateReminderEveryN: true,
          donateReminderUnit: true,
          donateReminderTimeMin: true,
          donateReminderTz: true,
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

// Advance a date by one billing cycle (mirrors lib/vps-subscription nextCycleDate;
// inlined so the bot stays free of the web app's @/-aliased imports).
function advanceCycle(from: Date, frequency: string | null): Date {
  const d = new Date(from);
  if (frequency === "WEEKLY") d.setDate(d.getDate() + 7);
  else if (frequency === "MONTHLY") d.setMonth(d.getMonth() + 1);
  else if (frequency === "YEARLY") d.setFullYear(d.getFullYear() + 1);
  return d;
}

// Auto-renewing VPS subscriptions (autoRenew + recurring + due) → log an APPROVED
// OUT expense for the rate and push the expiry forward one cycle. The expiry is
// based on `now`, so each due renewal charges exactly once (no catch-up avalanche
// if the bot was down).
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
        select: { id: true, name: true, price: true, currency: true, frequency: true },
      }),
    );

    let renewed = 0;
    for (const sub of due) {
      const price = sub.price != null ? Number(sub.price) : 0;
      if (!(price > 0)) continue;
      try {
        const tx = await dbRetry(() =>
          prisma.transaction.create({
            data: {
              amount: new Prisma.Decimal(price),
              currency: sub.currency ?? "INR",
              method: "OTHER",
              direction: "OUT",
              type: "SUBSCRIPTION",
              description: `VPS plan auto-renewal: ${sub.name}`,
              status: "APPROVED",
              date: now,
              createdById: admin.id,
            },
          }),
        );
        await dbRetry(() =>
          prisma.service.update({
            where: { id: sub.id },
            data: {
              paidTxId: tx.id,
              lastRenewalDate: now,
              expiryDate: advanceCycle(now, sub.frequency),
            },
          }),
        );
        scheduleFinanceAutomation({
          action: "CREATED",
          actorName: "Sentinel Auto-Renewal",
          transactionId: tx.id,
          sendBackup: true,
        });
        renewed++;
      } catch (e) {
        console.error(`[sub-renewal] Renewal failed for ${sub.id}:`, (e as Error).message);
      }
    }
    console.log(`[sub-renewal] Done. ${renewed} renewal(s) of ${due.length} due.`);
  } catch (err) {
    console.error("[sub-renewal] Check failed:", err);
  }
}

(async () => {
  await bot.api.deleteWebhook();
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
      console.log("[sub-renewal] Scheduled — first check in 30s, then every 24h");
    },
  });
})();
