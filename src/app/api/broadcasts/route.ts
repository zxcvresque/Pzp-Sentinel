import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Bot } from "grammy";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { escapeTelegramHtml } from "@/lib/telegram-format";
import { broadcastToTelegramHtml } from "@/lib/broadcast-format";

function telegramDestination() {
  return {
    groupId: process.env.TG_DONATION_GROUP_ID || process.env.TG_GROUP_ID || "",
    topicId: process.env.TG_DONATION_TOPIC_ID || "",
  };
}

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!hasRole(user.roles, "ADMIN")) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

export async function GET() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const donorCount = await prisma.user.count({
    where: { roles: { has: "DONOR" }, status: "ACTIVE" },
  });
  const { groupId } = telegramDestination();

  return NextResponse.json({
    donorCount,
    telegramConfigured: Boolean(process.env.BOT_TOKEN && groupId),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const user = auth.user;

  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const sendSentinel = body?.sendSentinel === true;
  const sendTelegram = body?.sendTelegram === true;

  if (!title || !message) {
    return NextResponse.json({ error: "Title and message are required" }, { status: 400 });
  }
  if (title.length > 80 || message.length > 3500) {
    return NextResponse.json({ error: "Title must be at most 80 characters and message at most 3,500" }, { status: 400 });
  }
  if (!sendSentinel && !sendTelegram) {
    return NextResponse.json({ error: "Select at least one destination" }, { status: 400 });
  }

  const broadcastId = randomUUID();
  const results: {
    sentinel?: { delivered: number };
    telegram?: { delivered: boolean; error?: string };
  } = {};

  if (sendSentinel) {
    const donors = await prisma.user.findMany({
      where: { roles: { has: "DONOR" }, status: "ACTIVE" },
      select: { id: true },
    });
    if (donors.length > 0) {
      const created = await prisma.notification.createMany({
        data: donors.map((donor) => ({
          userId: donor.id,
          type: "SYSTEM",
          title,
          message,
          entityId: `broadcast:${broadcastId}`,
          priority: "HIGH",
        })),
      });
      results.sentinel = { delivered: created.count };
    } else {
      results.sentinel = { delivered: 0 };
    }
  }

  if (sendTelegram) {
    const token = process.env.BOT_TOKEN;
    const { groupId, topicId } = telegramDestination();
    if (!token || !groupId) {
      results.telegram = { delivered: false, error: "Telegram donors group is not configured" };
    } else {
      try {
        const broadcastBot = new Bot(token);
        await broadcastBot.api.sendMessage(
          groupId,
          `<blockquote><b>📣 ${escapeTelegramHtml(title)}</b></blockquote>\n${broadcastToTelegramHtml(message)}\n\n<i>— ${escapeTelegramHtml(user.name)}, Sentinel</i>`,
          {
            parse_mode: "HTML",
            ...(topicId ? { message_thread_id: Number(topicId) } : {}),
          },
        );
        results.telegram = { delivered: true };
      } catch (error) {
        const description = typeof error === "object" && error && "description" in error
          ? String((error as { description?: unknown }).description || "Telegram delivery failed")
          : "Telegram delivery failed";
        results.telegram = { delivered: false, error: description };
      }
    }
  }

  await logAudit({
    userId: user.id,
    action: "BROADCAST",
    entityType: "Broadcast",
    entityId: broadcastId,
    after: { title, message, sendSentinel, sendTelegram, results },
    userName: user.name,
    details: `Broadcast “${title}” to ${[
      sendSentinel ? "Sentinel donors" : null,
      sendTelegram ? "Telegram donors group" : null,
    ].filter(Boolean).join(" and ")}`,
  });

  return NextResponse.json({ broadcastId, results });
}
