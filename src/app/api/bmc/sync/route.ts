import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { notify, notifyAdmins, formatTgMessage } from "@/lib/notifications";
import { scheduleFinanceAutomation } from "@/lib/finance-sheets";
import { Prisma } from "@/generated/prisma/client";
import { bmcAccountSlug, extractBmcAttributionCode, hashBmcAttributionCode } from "@/lib/bmc-attribution";
import { bmcLegacyPageItems, bmcSubscriptionPaymentKey, nextBmcLegacyPage, type BmcLegacyPage } from "@/lib/bmc-sync";
import { monthlyReminderUpdate } from "@/lib/donation-frequency";
import { dmThanks, donorHandle, groupThanks } from "@/lib/donation-thanks";
import { logTransaction, postDonationThanks } from "@/lib/telegram-log";
import { encryptSecret } from "@/lib/secret-crypto";

const BMC_BASE = "https://developers.buymeacoffee.com/api/v1";

interface BmcSupporter {
  support_id: number;
  transaction_id?: string | null;
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

interface BmcSubscription {
  subscription_id: number;
  transaction_id: string;
  subscription_coffee_price: string;
  subscription_coffee_num: number;
  subscription_currency: string;
  subscription_message: string | null;
  subscription_created_on: string;
  subscription_current_period_start: string;
  subscription_current_period_end: string;
  subscription_is_cancelled: number | boolean;
  supporter_name?: string | null;
  payer_name?: string | null;
  supporter_email?: string | null;
  payer_email?: string | null;
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

async function fetchAllPages<T>(path: string, source: string): Promise<T[]> {
  const all: T[] = [];
  let page = 1;

  while (page <= 100) {
    const separator = path.includes("?") ? "&" : "?";
    const response = await bmcFetch<BmcLegacyPage<T>>(`${path}${separator}page=${page}`);
    all.push(...bmcLegacyPageItems(response, source));
    const nextPage = nextBmcLegacyPage(response, page);
    if (!nextPage) break;
    page = nextPage;
    await delay(250);
  }
  return all;
}

const fetchAllSupporters = () => fetchAllPages<BmcSupporter>("/supporters", "supporters");
const fetchAllExtras = () => fetchAllPages<BmcExtra>("/extras", "extras");
const fetchAllSubscriptions = () => fetchAllPages<BmcSubscription>("/subscriptions?status=all", "subscriptions");

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
    // Fetch sequentially to avoid BMC rate limits. A broken optional endpoint
    // must not prevent the working sources from being reconciled.
    const sourceErrors: string[] = [];
    let supporters: BmcSupporter[] = [];
    let extras: BmcExtra[] = [];
    let subscriptions: BmcSubscription[] = [];
    try { supporters = await fetchAllSupporters(); } catch (error) {
      sourceErrors.push(error instanceof Error ? error.message : "supporters failed");
    }
    try { extras = await fetchAllExtras(); } catch (error) {
      sourceErrors.push(error instanceof Error ? error.message : "extras failed");
    }
    try { subscriptions = await fetchAllSubscriptions(); } catch (error) {
      sourceErrors.push(error instanceof Error ? error.message : "subscriptions failed");
    }

    let synced = 0;
    let monthlySynced = 0;
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

        await prisma.transaction.create({
          data: {
            amount: new Prisma.Decimal(amount),
            currency: "USD",
            method: "BMC",
            direction: "IN",
            type: "DONATION",
            description: `BMC one-time support x${s.support_coffees}`,
            providerDetailsEncrypted: encryptSecret(JSON.stringify({
              supporterName: name,
              supporterEmail: s.payer_email,
              note: s.support_note,
              providerReference: s.transaction_id || s.support_id,
            })),
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

        await prisma.transaction.create({
          data: {
            amount: new Prisma.Decimal(amount),
            currency: "USD",
            method: "BMC",
            direction: "IN",
            type: "DONATION",
            description: `BMC Extra · ${e.extra_title}`,
            providerDetailsEncrypted: encryptSecret(JSON.stringify({
              supporterName: name,
              supporterEmail: e.payer_email,
              note: e.extra_note,
              item: e.extra_title,
              providerReference: e.extra_id,
            })),
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

    // Import one transaction for the subscription's current billing period.
    // The period-based key prevents the same monthly charge being duplicated
    // when admins run sync repeatedly.
    for (const subscription of subscriptions) {
      try {
        const occurredAt = new Date(
          subscription.subscription_current_period_start || subscription.subscription_created_on,
        );
        const eventId = bmcSubscriptionPaymentKey(subscription.subscription_id, occurredAt);
        const exists = await prisma.transaction.findUnique({
          where: { bmcEventId: eventId },
          select: { id: true },
        });
        if (exists) {
          skipped++;
          continue;
        }

        const unitPrice = Number.parseFloat(subscription.subscription_coffee_price);
        const count = Math.max(1, Number(subscription.subscription_coffee_num) || 1);
        const amount = unitPrice * count;
        if (!Number.isFinite(amount) || amount <= 0) throw new Error("invalid subscription amount");
        const currency = subscription.subscription_currency?.toUpperCase() === "INR" ? "INR" : "USD";
        const supporterId = String(subscription.subscription_id);
        const supporterName = subscription.payer_name || subscription.supporter_name || "Anonymous";
        const supporterEmail = (subscription.payer_email || subscription.supporter_email || "").toLowerCase() || null;
        const code = extractBmcAttributionCode(subscription.subscription_message);
        const accountSlug = bmcAccountSlug();

        const result = await prisma.$transaction(async (db) => {
          const knownLink = await db.bmcSupporterLink.findUnique({
            where: { accountSlug_supporterId: { accountSlug, supporterId } },
          });
          let intent = null;
          if (!knownLink && code) {
            intent = await db.bmcCheckoutIntent.findFirst({
              where: {
                codeHash: hashBmcAttributionCode(code),
                consumedAt: null,
                createdAt: { lte: occurredAt },
                expiresAt: { gte: occurredAt },
              },
            });
            if (intent) {
              const claimed = await db.bmcCheckoutIntent.updateMany({
                where: { id: intent.id, consumedAt: null },
                data: { consumedAt: new Date() },
              });
              if (claimed.count !== 1) intent = null;
            }
          }
          const fromUserId = knownLink?.userId || intent?.userId || null;
          const transaction = await db.transaction.create({
            data: {
              amount: new Prisma.Decimal(amount),
              currency,
              method: "BMC",
              direction: "IN",
              type: "DONATION",
              donationFrequency: "MONTHLY",
              fromUserId,
              description: "BMC Monthly support",
              providerDetailsEncrypted: encryptSecret(JSON.stringify({
                supporterName,
                supporterEmail,
                note: subscription.subscription_message,
                attributionCode: code,
                providerReference: subscription.transaction_id,
                subscriptionId: subscription.subscription_id,
              })),
              status: "APPROVED",
              bmcEventId: eventId,
              date: occurredAt,
              createdById: user.id,
            },
            include: { fromUser: true },
          });
          if (knownLink) {
            await db.bmcSupporterLink.update({
              where: { id: knownLink.id },
              data: {
                supporterEmail: null,
                supporterDetailsEncrypted: encryptSecret(JSON.stringify({ supporterName, supporterEmail })),
                lastSeenAt: new Date(),
                donationFrequency: "MONTHLY",
              },
            });
          } else if (intent) {
            await db.bmcSupporterLink.create({
              data: {
                accountSlug,
                supporterId,
                supporterEmail: null,
                supporterDetailsEncrypted: encryptSecret(JSON.stringify({ supporterName, supporterEmail })),
                userId: intent.userId,
                donationFrequency: "MONTHLY",
              },
            });
            await db.bmcCheckoutIntent.update({
              where: { id: intent.id },
              data: { transactionId: transaction.id },
            });
          }
          if (fromUserId) {
            await db.user.update({
              where: { id: fromUserId },
              data: monthlyReminderUpdate("MONTHLY", occurredAt)!,
            });
          }
          return transaction;
        });

        synced++;
        monthlySynced++;
        const isRecent = Date.now() - occurredAt.getTime() <= 7 * 24 * 60 * 60 * 1000;
        if (isRecent && result.fromUser) {
          const amountLabel = `${currency === "INR" ? "₹" : "$"}${amount.toFixed(2)}`;
          await notify({
            userId: result.fromUser.id,
            type: "TX_APPROVED",
            title: "BMC monthly donation received — thank you!",
            message: `${amountLabel} was received through Buy Me a Coffee and added to your donation history.`,
            entityId: result.id,
            actionUrl: "/donor",
            telegramMessage: dmThanks(result.fromUser.name, amount, currency),
          });
          await postDonationThanks(groupThanks(
            donorHandle(result.fromUser.name, result.fromUser.telegramUser),
            amount,
            currency,
            "MONTHLY",
          ));
        }
        logTransaction({
          id: result.id,
          amount: result.amount,
          currency: result.currency,
          method: result.method,
          direction: result.direction,
          type: result.type,
          description: result.description,
          status: result.status,
          identityName: result.fromUser?.name || supporterName,
          identityTelegramUser: result.fromUser?.telegramUser,
          identityTelegramId: result.fromUser?.telegramId || supporterId,
          createdByName: "Buy Me a Coffee sync",
        });
      } catch (error) {
        errors.push(`subscription_${subscription.subscription_id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Audit log
    await logAudit({
      userId: user.id,
      action: "BMC_SYNC",
      entityType: "Transaction",
      entityId: "bmc-batch",
      userName: user.name,
      details: `Synced ${synced} new (${monthlySynced} monthly), skipped ${skipped} existing (${supporters.length} supporters, ${extras.length} extras, ${subscriptions.length} subscriptions)`,
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
      scheduleFinanceAutomation({
        action: "CREATED",
        actorName: user.name,
        transactionId: `bmc-batch-${synced}`,
        sendBackup: true,
      });
    }

    return NextResponse.json({
      synced,
      monthlySynced,
      skipped,
      totalSupporters: supporters.length,
      totalExtras: extras.length,
      totalSubscriptions: subscriptions.length,
      errors: [...sourceErrors, ...errors].length > 0 ? [...sourceErrors, ...errors] : undefined,
    });
  } catch (err) {
    console.error("BMC sync error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "BMC sync failed" },
      { status: 500 },
    );
  }
}
