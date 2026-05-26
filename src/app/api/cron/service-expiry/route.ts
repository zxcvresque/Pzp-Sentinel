import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { notifyAdmins, formatTgMessage } from "@/lib/notifications";
import type { NotifType } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // 1. Auth via secret token
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const in1Day = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
  const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // 2. Auto-expire services that are past their expiry date but still marked ACTIVE
  const expired = await prisma.service.updateMany({
    where: {
      status: "ACTIVE",
      expiryDate: { lte: now, not: null },
    },
    data: { status: "EXPIRED" },
  });

  // 3. Query active services expiring within 7 days
  const expiringServices = await prisma.service.findMany({
    where: {
      status: "ACTIVE",
      expiryDate: {
        not: null,
        lte: in7Days,
        gt: now,
      },
    },
    orderBy: { expiryDate: "asc" },
  });

  // 4. Send alerts for each expiring service
  let alertsSent = 0;

  for (const service of expiringServices) {
    const expiryDate = service.expiryDate!;
    const daysLeft = Math.ceil(
      (expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
    );

    // Categorize by urgency
    let urgencyEmoji: string;
    let urgencyHeading: string;
    let priority: "HIGH" | "NORMAL" | "LOW";

    if (expiryDate <= in1Day) {
      urgencyEmoji = "\u{1F534}"; // red circle
      urgencyHeading = "Service Expiring Tomorrow";
      priority = "HIGH";
    } else if (expiryDate <= in3Days) {
      urgencyEmoji = "\u{1F7E1}"; // yellow circle
      urgencyHeading = "Service Expiring Soon";
      priority = "NORMAL";
    } else {
      urgencyEmoji = "\u{1F4CB}"; // clipboard
      urgencyHeading = "Service Expiry Reminder";
      priority = "LOW";
    }

    const dateStr = expiryDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    const daysLabel = daysLeft === 1 ? "1 day" : `${daysLeft} days`;

    // Build price detail if available
    let priceDetail = "";
    if (service.price != null && service.currency && service.frequency) {
      priceDetail = `\nPrice: ${service.currency} ${service.price}/${service.frequency.toLowerCase()}`;
    }

    const title = `Service Expiring: ${service.name}`;
    const message = `${service.name} expires in ${daysLabel} (${dateStr}). Renew or update the service.`;

    const telegramMessage = formatTgMessage(
      `${urgencyEmoji} ${urgencyHeading}`,
      `${service.name} (${service.category})`,
      `Expires: ${dateStr} (${daysLabel} left)${priceDetail}`
    );

    await notifyAdmins({
      type: "SYSTEM" as NotifType,
      title,
      message,
      entityId: service.id,
      priority,
      telegramMessage,
    });

    alertsSent++;
  }

  // 5. Return summary
  return NextResponse.json({
    checked: new Date().toISOString(),
    autoExpired: expired.count,
    alerts: alertsSent,
    services: expiringServices.map((s) => ({
      name: s.name,
      category: s.category,
      expiryDate: s.expiryDate,
      daysLeft: Math.ceil(
        (s.expiryDate!.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
      ),
    })),
  });
}
