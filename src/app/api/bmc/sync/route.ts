import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { notifyAdmins, formatTgMessage } from "@/lib/notifications";
import { Prisma } from "@/generated/prisma/client";

const BMC_BASE = "https://developers.buymeacoffee.com/api/v1";

interface BmcSupporter {
  support_id: number;
  supporter_name: string;
  support_coffee_price: string;
  support_coffees: number;
  support_note: string | null;
  support_created_on: string;
  transfer_id: string | null;
  payer_email: string | null;
  payer_name: string | null;
}

interface BmcExtra {
  extra_id: number;
  supporter_name: string;
  extra_price: string;
  extra_title: string;
  extra_note: string | null;
  extra_created_on: string;
  payer_email: string | null;
}

interface BmcSupportersResponse {
  current_page: number;
  data: BmcSupporter[];
  last_page: number;
}

interface BmcExtrasResponse {
  current_page: number;
  data: BmcExtra[];
  last_page: number;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function bmcFetch<T>(path: string, retries = 2): Promise<T> {
  const token = process.env.BMC_TOKEN;
  if (!token) throw new Error("BMC_TOKEN not configured");

  for (let i = 0; i < retries; i++) {
    if (i > 0) await delay(10000); // wait 10s before single retry

    const res = await fetch(`${BMC_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 429) {
      console.warn(`[BMC] Rate limited on ${path}, attempt ${i + 1}/${retries}`);
      if (i === retries - 1) throw new Error("BMC rate limited — try again in a few minutes");
      continue;
    }

    if (res.status === 401) {
      throw new Error("BMC token expired or invalid — regenerate at buymeacoffee.com/dashboard/developers");
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`BMC API error ${res.status}: ${text.slice(0, 200)}`);
    }

    return res.json() as Promise<T>;
  }

  throw new Error("BMC API rate limited after retries");
}

async function fetchAllSupporters(): Promise<BmcSupporter[]> {
  const all: BmcSupporter[] = [];
  let page = 1;

  while (true) {
    const res = await bmcFetch<BmcSupportersResponse>(`/supporters?page=${page}`);
    all.push(...(res.data || []));
    if (page >= res.last_page) break;
    page++;
    await delay(500); // pace between pages
  }

  return all;
}

async function fetchAllExtras(): Promise<BmcExtra[]> {
  const all: BmcExtra[] = [];
  let page = 1;

  while (true) {
    const res = await bmcFetch<BmcExtrasResponse>(`/extras?page=${page}`);
    all.push(...(res.data || []));
    if (page >= res.last_page) break;
    page++;
    await delay(500); // pace between pages
  }

  return all;
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  if (!process.env.BMC_TOKEN) {
    return NextResponse.json({ error: "BMC_TOKEN not configured" }, { status: 500 });
  }

  try {
    // Fetch sequentially to avoid BMC rate limits
    const supporters = await fetchAllSupporters();
    await delay(2000); // breathing room between endpoints
    const extras = await fetchAllExtras();

    let synced = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Process one-time supporters
    for (const s of supporters) {
      const eventId = `bmc_support_${s.support_id}`;
      try {
        const exists = await prisma.transaction.findUnique({
          where: { bmcEventId: eventId },
          select: { id: true },
        });
        if (exists) {
          skipped++;
          continue;
        }

        const amount = parseFloat(s.support_coffee_price) * s.support_coffees;
        const name = s.payer_name || s.supporter_name || "Anonymous";
        const note = s.support_note ? ` - "${s.support_note}"` : "";

        await prisma.transaction.create({
          data: {
            amount: new Prisma.Decimal(amount),
            currency: "USD",
            method: "BMC",
            direction: "IN",
            type: "DONATION",
            description: `BMC: ${name} x${s.support_coffees} coffee${s.support_coffees > 1 ? "s" : ""}${note}`,
            status: "APPROVED",
            bmcEventId: eventId,
            date: new Date(s.support_created_on),
            createdById: user.id,
          },
        });
        synced++;
      } catch (err) {
        errors.push(`support_${s.support_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Process extras (memberships/recurring)
    for (const e of extras) {
      const eventId = `bmc_extra_${e.extra_id}`;
      try {
        const exists = await prisma.transaction.findUnique({
          where: { bmcEventId: eventId },
          select: { id: true },
        });
        if (exists) {
          skipped++;
          continue;
        }

        const amount = parseFloat(e.extra_price);
        const name = e.supporter_name || "Anonymous";
        const note = e.extra_note ? ` - "${e.extra_note}"` : "";

        await prisma.transaction.create({
          data: {
            amount: new Prisma.Decimal(amount),
            currency: "USD",
            method: "BMC",
            direction: "IN",
            type: "DONATION",
            description: `BMC Extra: ${name} - ${e.extra_title}${note}`,
            status: "APPROVED",
            bmcEventId: eventId,
            date: new Date(e.extra_created_on),
            createdById: user.id,
          },
        });
        synced++;
      } catch (err) {
        errors.push(`extra_${e.extra_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Audit log
    await logAudit({
      userId: user.id,
      action: "BMC_SYNC",
      entityType: "Transaction",
      entityId: "bmc-batch",
      userName: user.name,
      details: `Synced ${synced} new, skipped ${skipped} existing (${supporters.length} supporters, ${extras.length} extras)`,
    });

    // Notify admins if new transactions were synced
    if (synced > 0) {
      await notifyAdmins({
        type: "SYSTEM",
        title: "BMC Sync Complete",
        message: `${synced} new donation${synced > 1 ? "s" : ""} imported from Buy Me a Coffee`,
        actionUrl: "/admin/transactions",
        telegramMessage: formatTgMessage(
          "🔄 BMC Sync",
          `${synced} new donation${synced > 1 ? "s" : ""} imported`,
          `Skipped ${skipped} existing · By: ${user.name}`,
        ),
      });
    }

    return NextResponse.json({
      synced,
      skipped,
      totalSupporters: supporters.length,
      totalExtras: extras.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error("BMC sync error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "BMC sync failed" },
      { status: 500 },
    );
  }
}
