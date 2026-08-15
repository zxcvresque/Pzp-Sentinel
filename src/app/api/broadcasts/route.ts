import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Bot } from "grammy";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { escapeTelegramHtml } from "@/lib/telegram-format";
import { broadcastInlineToTelegramHtml, broadcastToTelegramHtml } from "@/lib/broadcast-format";
import { notify } from "@/lib/notifications";
import {
  broadcastAudienceRoles,
  canSendBroadcastToTelegramGroup,
  parseBroadcastAudience,
  parseBroadcastRecipientMode,
} from "@/lib/broadcast-audience";
import { parseReminderRepeatUnit } from "@/lib/admin-reminders";

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

  const recipients = await prisma.user.findMany({
    where: { roles: { hasSome: ["ADMIN", "DONOR", "DEV"] }, status: "ACTIVE" },
    orderBy: [{ name: "asc" }, { telegramUser: "asc" }],
    select: {
      id: true,
      name: true,
      telegramUser: true,
      photoUrl: true,
      roles: true,
    },
  });
  const { groupId } = telegramDestination();
  const schedules = await prisma.scheduledBroadcast.findMany({
    where: { active: true },
    orderBy: { nextFire: "asc" },
    include: { createdBy: { select: { name: true } } },
  });

  return NextResponse.json({
    recipients,
    counts: {
      admins: recipients.filter((recipient) => recipient.roles.includes("ADMIN")).length,
      donors: recipients.filter((recipient) => recipient.roles.includes("DONOR")).length,
      devs: recipients.filter((recipient) => recipient.roles.includes("DEV")).length,
      everyone: recipients.length,
    },
    telegramConfigured: Boolean(process.env.BOT_TOKEN && groupId),
    schedules,
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
  const highPriority = body?.highPriority !== false;
  const audience = parseBroadcastAudience(body?.audience ?? "DONORS");
  const recipientMode = parseBroadcastRecipientMode(body?.recipientMode ?? "ALL");
  const rawRecipientIds: unknown[] = Array.isArray(body?.recipientIds) ? body.recipientIds : [];
  const recipientIds = [...new Set(rawRecipientIds.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  ))];
  const repeat = body?.repeat === true;
  const repeatEvery = Number(body?.repeatEvery);
  const repeatUnit = parseReminderRepeatUnit(body?.repeatUnit);
  const firstSend = new Date(body?.firstSend);

  if (!title || !message) {
    return NextResponse.json({ error: "Title and message are required" }, { status: 400 });
  }
  if (title.length > 80 || message.length > 3500) {
    return NextResponse.json({ error: "Title must be at most 80 characters and message at most 3,500" }, { status: 400 });
  }
  if (!sendSentinel && !sendTelegram) {
    return NextResponse.json({ error: "Select at least one destination" }, { status: 400 });
  }
  if (!audience || !recipientMode) {
    return NextResponse.json({ error: "Select a valid audience and recipient mode" }, { status: 400 });
  }
  if (recipientIds.length > 5000) {
    return NextResponse.json({ error: "Select at most 5,000 recipients" }, { status: 400 });
  }
  if (sendSentinel && recipientMode === "SELECTED" && recipientIds.length === 0) {
    return NextResponse.json({ error: "Select at least one recipient" }, { status: 400 });
  }
  if (sendTelegram && !canSendBroadcastToTelegramGroup(audience, recipientMode)) {
    return NextResponse.json({
      error: recipientMode === "SELECTED"
        ? "Telegram group delivery is unavailable for individually targeted broadcasts"
        : "The configured Telegram group is for donor-inclusive broadcasts only",
    }, { status: 400 });
  }
  if (repeat && (
    Number.isNaN(firstSend.getTime())
    || firstSend <= new Date()
    || !Number.isInteger(repeatEvery)
    || repeatEvery < 1
    || repeatEvery > 10_000
    || !repeatUnit
  )) {
    return NextResponse.json({
      error: "Repeating broadcasts require a future first-send time, a whole number from 1 to 10,000, and a valid unit",
    }, { status: 400 });
  }

  if (repeat) {
    const schedule = await prisma.scheduledBroadcast.create({
      data: {
        createdById: user.id,
        title,
        message,
        audience,
        recipientMode,
        recipientIds: recipientMode === "SELECTED" ? recipientIds : [],
        sendSentinel,
        sendTelegram,
        highPriority,
        repeatEvery,
        repeatUnit: repeatUnit!,
        nextFire: firstSend,
      },
      include: { createdBy: { select: { name: true } } },
    });

    await logAudit({
      userId: user.id,
      action: "BROADCAST_SCHEDULED",
      entityType: "ScheduledBroadcast",
      entityId: schedule.id,
      after: {
        title,
        audience,
        recipientMode,
        recipientIds: recipientMode === "SELECTED" ? recipientIds : undefined,
        highPriority,
        sendSentinel,
        sendTelegram,
        repeatEvery,
        repeatUnit,
        firstSend,
      },
      userName: user.name,
      details: `Scheduled repeating broadcast “${title}” every ${repeatEvery} ${repeatUnit!.toLowerCase()}(s)`,
    });

    return NextResponse.json({ scheduled: true, schedule }, { status: 201 });
  }

  const broadcastId = randomUUID();
  const results: {
    sentinel?: { requested: number; delivered: number; failed: number };
    telegram?: { delivered: boolean; error?: string };
  } = {};

  if (sendSentinel) {
    const audienceRoles = broadcastAudienceRoles(audience);
    const recipients = await prisma.user.findMany({
      where: {
        roles: { hasSome: audienceRoles },
        status: "ACTIVE",
        ...(recipientMode === "SELECTED" ? { id: { in: recipientIds } } : {}),
      },
      select: { id: true },
    });

    if (recipientMode === "SELECTED" && recipients.length !== recipientIds.length) {
      return NextResponse.json({
        error: "One or more selected recipients are inactive or outside the selected audience",
      }, { status: 400 });
    }

    if (highPriority) {
      let delivered = 0;
      const telegramMessage = `<blockquote>📣 ${broadcastInlineToTelegramHtml(title)}</blockquote>\n${broadcastToTelegramHtml(message)}\n\n<i>— ${escapeTelegramHtml(user.name)}, Sentinel</i>`;
      for (let start = 0; start < recipients.length; start += 20) {
        const batch = recipients.slice(start, start + 20);
        const settled = await Promise.allSettled(batch.map((recipient) => notify({
          userId: recipient.id,
          type: "SYSTEM",
          title,
          message,
          entityId: `broadcast:${broadcastId}`,
          priority: "HIGH",
          telegramMessage,
        })));
        delivered += settled.filter((result) => result.status === "fulfilled").length;
      }
      results.sentinel = {
        requested: recipients.length,
        delivered,
        failed: recipients.length - delivered,
      };
    } else if (recipients.length > 0) {
      const created = await prisma.notification.createMany({
        data: recipients.map((recipient) => ({
          userId: recipient.id,
          type: "SYSTEM",
          title,
          message,
          entityId: `broadcast:${broadcastId}`,
          priority: "NORMAL",
        })),
      });
      results.sentinel = {
        requested: recipients.length,
        delivered: created.count,
        failed: recipients.length - created.count,
      };
    } else {
      results.sentinel = { requested: 0, delivered: 0, failed: 0 };
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
          `<blockquote>📣 ${broadcastInlineToTelegramHtml(title)}</blockquote>\n${broadcastToTelegramHtml(message)}\n\n<i>— ${escapeTelegramHtml(user.name)}, Sentinel</i>`,
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
    after: {
      title,
      message,
      audience,
      recipientMode,
      recipientIds: recipientMode === "SELECTED" ? recipientIds : undefined,
      highPriority,
      sendSentinel,
      sendTelegram,
      results,
    },
    userName: user.name,
    details: `Broadcast “${title}” (${highPriority ? "high" : "normal"} priority) to ${[
      sendSentinel ? `Sentinel ${audience.toLowerCase()}` : null,
      sendTelegram ? "Telegram donors group" : null,
    ].filter(Boolean).join(" and ")}`,
  });

  return NextResponse.json({ broadcastId, results });
}
