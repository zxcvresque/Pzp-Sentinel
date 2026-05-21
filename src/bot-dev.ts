import "dotenv/config";
import { Bot } from "grammy";
import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { logAuditEvent } from "./lib/telegram-log";

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
        `<blockquote><b>Your Telegram ID</b></blockquote>\n` +
        `<code>${telegramId}</code>\n\n` +
        `<i>Copy and paste it on the login page.</i>`,
        { parse_mode: "HTML" },
      );
    } catch (err) {
      console.error("Failed to reply with user ID:", err);
    }
    return;
  }

  let user = await dbRetry(() => prisma.user.findUnique({ where: { telegramId } }));

  if (user) {
    await dbRetry(() => prisma.user.update({
      where: { id: user!.id },
      data: { chatId },
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

    try {
      await ctx.reply(
        `<blockquote><b>Welcome to Sentinel</b></blockquote>\n` +
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
        `<blockquote><b>Account Deactivated</b></blockquote>\n` +
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
        `<blockquote><b>Pending Approval</b></blockquote>\n` +
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
      `<b><i>Welcome back, ${user.name}!</i></b>\n\n` +
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
      `<blockquote><b>Sentinel Commands</b></blockquote>\n` +
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

(async () => {
  await bot.api.deleteWebhook();
  console.log("Sentinel bot starting in polling mode...");
  bot.start({
    onStart: () => console.log("Sentinel bot is live! Send /start to @" + process.env.BOT_USERNAME),
  });
})();
