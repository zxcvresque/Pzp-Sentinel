import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { notifyAdmins, formatTgMessage } from "@/lib/notifications";
import { scheduleFinanceAutomation } from "@/lib/finance-sheets";

/* ------------------------------------------------------------------ */
/*  BMC Webhook signature verification                                 */
/* ------------------------------------------------------------------ */

function verifySignature(rawBody: string, signature: string): boolean {
  const secret = process.env.BMC_WEBHOOK_SECRET;
  if (!secret) return false;

  const computed = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  return computed === signature;
}

/* ------------------------------------------------------------------ */
/*  Webhook event types → handler map                                  */
/* ------------------------------------------------------------------ */

// BMC webhook payload shape (common fields)
interface BmcWebhookPayload {
  type: string;
  // One-time support
  supporter_name?: string;
  supporter_email?: string;
  support_id?: number;
  support_coffee_price?: string;
  support_coffees?: number;
  support_note?: string;
  support_created_on?: string;
  // Extras
  extra_id?: number;
  extra_title?: string;
  extra_price?: string;
  extra_note?: string;
  extra_created_on?: string;
  // Membership
  membership_id?: number;
  membership_level_name?: string;
  membership_price?: string;
  membership_started_on?: string;
  // Commission
  commission_order_id?: number;
  commission_order_price?: string;
  commission_order_created_on?: string;
  // Wishlist
  wishlist_payment_id?: number;
  wishlist_item_name?: string;
  wishlist_payment_price?: string;
  wishlist_payment_created_on?: string;
  // Refund fields
  refund_amount?: string;
  // Generic
  amount?: string;
  created_on?: string;
  payer_name?: string;
  payer_email?: string;
}

/* ------------------------------------------------------------------ */
/*  POST handler                                                       */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest) {
  const secret = process.env.BMC_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  // Read raw body for signature verification
  const rawBody = await req.text();
  const signature = req.headers.get("x-bmc-signature") || "";

  if (!verifySignature(rawBody, signature)) {
    console.warn("BMC webhook: invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: BmcWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = payload.type || "unknown";
  console.info(`BMC webhook received: ${eventType}`);

  try {
    // Get a system admin to attribute auto-created transactions
    const systemAdmin = await prisma.user.findFirst({
      where: { roles: { has: "ADMIN" }, status: "ACTIVE" },
      select: { id: true, name: true },
    });

    if (!systemAdmin) {
      console.error("BMC webhook: no active admin found for attribution");
      return NextResponse.json({ error: "No admin found" }, { status: 500 });
    }

    switch (eventType) {
      /* ---- One-time support ---- */
      case "payment.created": {
        const eventId = `bmc_support_${payload.support_id}`;
        const exists = await prisma.transaction.findUnique({
          where: { bmcEventId: eventId },
          select: { id: true },
        });
        if (exists) return NextResponse.json({ status: "duplicate" });

        const amount =
          parseFloat(payload.support_coffee_price || "0") *
          (payload.support_coffees || 1);
        const name = payload.payer_name || payload.supporter_name || "Anonymous";
        const note = payload.support_note ? ` — "${payload.support_note}"` : "";

        const tx = await prisma.transaction.create({
          data: {
            amount: new Prisma.Decimal(amount),
            currency: "USD",
            method: "BMC",
            direction: "IN",
            type: "DONATION",
            description: `BMC: ${name} x${payload.support_coffees || 1} coffee${(payload.support_coffees || 1) > 1 ? "s" : ""}${note}`,
            status: "APPROVED",
            bmcEventId: eventId,
            date: payload.support_created_on
              ? new Date(payload.support_created_on)
              : new Date(),
            createdById: systemAdmin.id,
          },
        });

        await logAudit({
          userId: systemAdmin.id,
          action: "BMC_WEBHOOK",
          entityType: "Transaction",
          entityId: tx.id,
          userName: "Webhook",
          details: `New support: $${amount} from ${name}`,
        });

        try {
          await notifyAdmins({
            type: "SYSTEM",
            title: "New BMC Donation",
            message: `$${amount} from ${name}${note}`,
            entityId: tx.id,
            actionUrl: "/admin/transactions",
            telegramMessage: formatTgMessage(
              "☕ New Donation",
              `$${amount.toFixed(2)} from ${name}`,
              note || undefined,
            ),
          });
          console.info("BMC webhook: notifications sent");
        } catch (notifErr) {
          console.error("BMC webhook: notification failed:", notifErr);
        }

        scheduleFinanceAutomation({ action: "CREATED", actorName: "Buy Me a Coffee", transactionId: tx.id, sendBackup: true });
        return NextResponse.json({ status: "created", id: tx.id });
      }

      /* ---- Support refunded ---- */
      case "payment.refunded": {
        const eventId = `bmc_support_${payload.support_id}`;
        const existing = await prisma.transaction.findUnique({
          where: { bmcEventId: eventId },
        });

        if (existing) {
          await prisma.transaction.update({
            where: { id: existing.id },
            data: {
              status: "REJECTED",
              reviewNote: "Refunded via BMC",
            },
          });

          await notifyAdmins({
            type: "SYSTEM",
            title: "BMC Refund",
            message: `$${existing.amount} support refunded`,
            entityId: existing.id,
            actionUrl: "/admin/transactions",
            telegramMessage: formatTgMessage(
              "🔄 Refund",
              `$${existing.amount} support refunded`,
            ),
          });
        }

        scheduleFinanceAutomation({ action: "UPDATED", actorName: "Buy Me a Coffee" });
        return NextResponse.json({ status: "refund_processed" });
      }

      /* ---- Extras purchased ---- */
      case "extras.purchased": {
        const eventId = `bmc_extra_${payload.extra_id}`;
        const exists = await prisma.transaction.findUnique({
          where: { bmcEventId: eventId },
          select: { id: true },
        });
        if (exists) return NextResponse.json({ status: "duplicate" });

        const amount = parseFloat(payload.extra_price || "0");
        const name = payload.payer_name || payload.supporter_name || "Anonymous";
        const title = payload.extra_title || "Extra";
        const note = payload.extra_note ? ` — "${payload.extra_note}"` : "";

        const tx = await prisma.transaction.create({
          data: {
            amount: new Prisma.Decimal(amount),
            currency: "USD",
            method: "BMC",
            direction: "IN",
            type: "DONATION",
            description: `BMC Extra: ${name} — ${title}${note}`,
            status: "APPROVED",
            bmcEventId: eventId,
            date: payload.extra_created_on
              ? new Date(payload.extra_created_on)
              : new Date(),
            createdById: systemAdmin.id,
          },
        });

        await notifyAdmins({
          type: "SYSTEM",
          title: "New BMC Extra",
          message: `$${amount} — ${title} from ${name}`,
          entityId: tx.id,
          actionUrl: "/admin/transactions",
          telegramMessage: formatTgMessage(
            "🎁 New Extra Purchase",
            `$${amount.toFixed(2)} — ${title}`,
            `From ${name}${note}`,
          ),
        });

        scheduleFinanceAutomation({ action: "CREATED", actorName: "Buy Me a Coffee", transactionId: tx.id, sendBackup: true });
        return NextResponse.json({ status: "created", id: tx.id });
      }

      /* ---- Extras refunded ---- */
      case "extras.refunded": {
        const eventId = `bmc_extra_${payload.extra_id}`;
        const existing = await prisma.transaction.findUnique({
          where: { bmcEventId: eventId },
        });

        if (existing) {
          await prisma.transaction.update({
            where: { id: existing.id },
            data: { status: "REJECTED", reviewNote: "Refunded via BMC" },
          });

          await notifyAdmins({
            type: "SYSTEM",
            title: "🔄 BMC Extra Refund",
            message: `$${existing.amount} extra refunded`,
            entityId: existing.id,
            actionUrl: "/admin/transactions",
          });
        }

        scheduleFinanceAutomation({ action: "UPDATED", actorName: "Buy Me a Coffee" });
        return NextResponse.json({ status: "refund_processed" });
      }

      /* ---- Monthly support / Membership ---- */
      case "monthly_support.started":
      case "membership.started": {
        const isMembership = eventType.startsWith("membership");
        const id = isMembership ? payload.membership_id : payload.support_id;
        const prefix = isMembership ? "bmc_membership" : "bmc_monthly";
        const eventId = `${prefix}_${id}`;

        const exists = await prisma.transaction.findUnique({
          where: { bmcEventId: eventId },
          select: { id: true },
        });
        if (exists) return NextResponse.json({ status: "duplicate" });

        const amount = parseFloat(
          (isMembership ? payload.membership_price : payload.support_coffee_price) || "0",
        );
        const name = payload.payer_name || payload.supporter_name || "Anonymous";
        const label = isMembership
          ? `Membership: ${payload.membership_level_name || "Member"}`
          : "Monthly support";

        const tx = await prisma.transaction.create({
          data: {
            amount: new Prisma.Decimal(amount),
            currency: "USD",
            method: "BMC",
            direction: "IN",
            type: "DONATION",
            description: `BMC ${label} from ${name}`,
            status: "APPROVED",
            bmcEventId: eventId,
            date: new Date(),
            createdById: systemAdmin.id,
          },
        });

        await notifyAdmins({
          type: "SYSTEM",
          title: `New BMC ${isMembership ? "Membership" : "Monthly Support"}`,
          message: `$${amount}/mo from ${name}`,
          entityId: tx.id,
          actionUrl: "/admin/transactions",
          telegramMessage: formatTgMessage(
            isMembership ? "🤝 New Membership" : "💛 New Monthly Support",
            `$${amount.toFixed(2)}/mo from ${name}`,
          ),
        });

        scheduleFinanceAutomation({ action: "CREATED", actorName: "Buy Me a Coffee", transactionId: tx.id, sendBackup: true });
        return NextResponse.json({ status: "created", id: tx.id });
      }

      /* ---- Monthly/Membership cancelled ---- */
      case "monthly_support.cancelled":
      case "membership.cancelled": {
        const name = payload.payer_name || payload.supporter_name || "Someone";
        await notifyAdmins({
          type: "SYSTEM",
          title: "BMC Cancellation",
          message: `${name} cancelled their recurring support`,
          actionUrl: "/admin/transactions",
          telegramMessage: formatTgMessage(
            "👋 Cancellation",
            `${name} cancelled recurring support`,
          ),
        });
        return NextResponse.json({ status: "noted" });
      }

      /* ---- Commission orders ---- */
      case "commission_order.created": {
        const eventId = `bmc_commission_${payload.commission_order_id}`;
        const exists = await prisma.transaction.findUnique({
          where: { bmcEventId: eventId },
          select: { id: true },
        });
        if (exists) return NextResponse.json({ status: "duplicate" });

        const amount = parseFloat(payload.commission_order_price || "0");
        const name = payload.payer_name || payload.supporter_name || "Anonymous";

        const tx = await prisma.transaction.create({
          data: {
            amount: new Prisma.Decimal(amount),
            currency: "USD",
            method: "BMC",
            direction: "IN",
            type: "DONATION",
            description: `BMC Commission from ${name}`,
            status: "APPROVED",
            bmcEventId: eventId,
            date: payload.commission_order_created_on
              ? new Date(payload.commission_order_created_on)
              : new Date(),
            createdById: systemAdmin.id,
          },
        });

        await notifyAdmins({
          type: "SYSTEM",
          title: "New BMC Commission",
          message: `$${amount} from ${name}`,
          entityId: tx.id,
          actionUrl: "/admin/transactions",
          telegramMessage: formatTgMessage(
            "🎨 New Commission",
            `$${amount.toFixed(2)} from ${name}`,
          ),
        });

        scheduleFinanceAutomation({ action: "CREATED", actorName: "Buy Me a Coffee", transactionId: tx.id, sendBackup: true });
        return NextResponse.json({ status: "created", id: tx.id });
      }

      /* ---- Wishlist payments ---- */
      case "wishlist_payment.created": {
        const eventId = `bmc_wishlist_${payload.wishlist_payment_id}`;
        const exists = await prisma.transaction.findUnique({
          where: { bmcEventId: eventId },
          select: { id: true },
        });
        if (exists) return NextResponse.json({ status: "duplicate" });

        const amount = parseFloat(payload.wishlist_payment_price || "0");
        const name = payload.payer_name || payload.supporter_name || "Anonymous";
        const item = payload.wishlist_item_name || "Wishlist item";

        const tx = await prisma.transaction.create({
          data: {
            amount: new Prisma.Decimal(amount),
            currency: "USD",
            method: "BMC",
            direction: "IN",
            type: "DONATION",
            description: `BMC Wishlist: ${item} from ${name}`,
            status: "APPROVED",
            bmcEventId: eventId,
            date: payload.wishlist_payment_created_on
              ? new Date(payload.wishlist_payment_created_on)
              : new Date(),
            createdById: systemAdmin.id,
          },
        });

        await notifyAdmins({
          type: "SYSTEM",
          title: "BMC Wishlist Payment",
          message: `$${amount} — ${item} from ${name}`,
          entityId: tx.id,
          actionUrl: "/admin/transactions",
          telegramMessage: formatTgMessage(
            "⭐ Wishlist Payment",
            `$${amount.toFixed(2)} — ${item} from ${name}`,
          ),
        });

        scheduleFinanceAutomation({ action: "CREATED", actorName: "Buy Me a Coffee", transactionId: tx.id, sendBackup: true });
        return NextResponse.json({ status: "created", id: tx.id });
      }

      /* ---- Refunds for commission/wishlist ---- */
      case "commission_order.refunded": {
        const eventId = `bmc_commission_${payload.commission_order_id}`;
        const existing = await prisma.transaction.findUnique({ where: { bmcEventId: eventId } });
        if (existing) {
          await prisma.transaction.update({
            where: { id: existing.id },
            data: { status: "REJECTED", reviewNote: "Refunded via BMC" },
          });
        }
        scheduleFinanceAutomation({ action: "UPDATED", actorName: "Buy Me a Coffee" });
        return NextResponse.json({ status: "refund_processed" });
      }

      case "wishlist_payment.refunded": {
        const eventId = `bmc_wishlist_${payload.wishlist_payment_id}`;
        const existing = await prisma.transaction.findUnique({ where: { bmcEventId: eventId } });
        if (existing) {
          await prisma.transaction.update({
            where: { id: existing.id },
            data: { status: "REJECTED", reviewNote: "Refunded via BMC" },
          });
        }
        scheduleFinanceAutomation({ action: "UPDATED", actorName: "Buy Me a Coffee" });
        return NextResponse.json({ status: "refund_processed" });
      }

      /* ---- Updates (monthly/membership/extras) — log but no new tx ---- */
      case "monthly_support.updated":
      case "membership.updated":
      case "extras.updated": {
        console.info(`BMC webhook: ${eventType} — logged, no action needed`);
        return NextResponse.json({ status: "noted" });
      }

      default:
        console.warn(`BMC webhook: unhandled event type "${eventType}"`);
        return NextResponse.json({ status: "unhandled", type: eventType });
    }
  } catch (err) {
    console.error("BMC webhook processing error:", err);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 },
    );
  }
}
