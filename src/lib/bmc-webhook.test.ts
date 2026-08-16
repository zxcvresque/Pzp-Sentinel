import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import {
  bmcRecoverySignature,
  bmcTransactionKeys,
  parseBmcWebhook,
  verifyBmcRecoverySignature,
  verifyBmcSignature,
} from "./bmc-webhook";

describe("Buy Me a Coffee webhook", () => {
  it("verifies the current x-signature-sha256 HMAC in constant-time format", () => {
    const body = JSON.stringify({ event_id: 1234, type: "donation.created", data: {} });
    const secret = "webhook-signing-secret";
    const signature = createHmac("sha256", secret).update(body).digest("hex");

    expect(verifyBmcSignature(body, signature, secret)).toBe(true);
    expect(verifyBmcSignature(body, `sha256=${signature}`, secret)).toBe(true);
    expect(verifyBmcSignature(`${body} `, signature, secret)).toBe(false);
    expect(verifyBmcSignature(body, "bad", secret)).toBe(false);
  });

  it("keeps operator recovery signatures separate from provider signatures", () => {
    const body = JSON.stringify({ event_id: 1234, type: "donation.created", data: {} });
    const secret = "webhook-signing-secret";
    const recoverySignature = bmcRecoverySignature(body, secret);

    expect(verifyBmcRecoverySignature(body, recoverySignature, secret)).toBe(true);
    expect(verifyBmcSignature(body, recoverySignature, secret)).toBe(false);
    expect(verifyBmcRecoverySignature(`${body} `, recoverySignature, secret)).toBe(false);
  });

  it("normalizes the current donation envelope and marks dashboard tests", () => {
    const event = parseBmcWebhook(JSON.stringify({
      event_id: 1,
      type: "donation.created",
      live_mode: false,
      created: 1719825600,
      attempt: 1,
      data: {
        id: 98765,
        amount: 15,
        coffee_count: 3,
        coffee_price: 5,
        currency: "USD",
        supporter_name: "Alex",
        supporter_id: 42,
        supporter_email: "Alex@Example.com",
        support_note: "Keep building",
        created_at: 1719825600,
      },
    }));

    expect(event.type).toBe("donation.created");
    expect(event.resourceId).toBe("98765");
    expect(event.supporterName).toBe("Alex");
    expect(event.supporterId).toBe("42");
    expect(event.supporterEmail).toBe("alex@example.com");
    expect(event.amount).toBe(15);
    expect(event.currency).toBe("USD");
    expect(event.note).toBe("Keep building");
    expect(event.donationFrequency).toBe("ONE_TIME");
    expect(event.liveMode).toBe(false);
    expect(event.eventKey).toMatch(/^test:1:donation\.created:/);
  });

  it("normalizes extras and legacy event aliases", () => {
    const current = parseBmcWebhook(JSON.stringify({
      event_id: 42,
      type: "extra_purchase.created",
      live_mode: true,
      created: 1719825600,
      attempt: 1,
      data: {
        id: 80,
        amount: 25,
        currency: "USD",
        supporter_name: "Sam",
        extras: [{ id: 2, title: "Sticker pack", quantity: 2 }],
      },
    }));
    const legacy = parseBmcWebhook(JSON.stringify({
      type: "monthly_support.started",
      support_id: 9,
      support_coffee_price: "5",
      supporter_name: "Kai",
    }));

    expect(current.itemLabel).toBe("Sticker pack x2");
    expect(current.eventKey).toBe("live:42");
    expect(legacy.type).toBe("recurring_donation.started");
    expect(legacy.amount).toBe(5);
  });

  it("deduplicates BMC started/updated deliveries for one billing period", () => {
    const baseData = {
      id: 123,
      amount: 6,
      object: "recurring_donation",
      psp_id: "sub_provider_123",
      status: "active",
      currency: "USD",
      started_at: 1786839390,
      current_period_start: 1786839387,
      supporter_id: 456,
      supporter_name: "Monthly Donor",
      supporter_email: "donor@example.test",
      support_note: "PZP-BMC-TEST-CODE",
    };
    const started = parseBmcWebhook(JSON.stringify({
      event_id: 1001,
      type: "recurring_donation.started",
      live_mode: true,
      created: 1786839411,
      data: baseData,
    }));
    const updated = parseBmcWebhook(JSON.stringify({
      event_id: 1002,
      type: "recurring_donation.updated",
      live_mode: true,
      created: 1786839411,
      data: baseData,
    }));
    const nextMonth = parseBmcWebhook(JSON.stringify({
      event_id: 1003,
      type: "recurring_donation.updated",
      live_mode: true,
      created: 1789517787,
      data: { ...baseData, current_period_start: 1789517787 },
    }));

    expect(started.resourceId).toBe("sub_provider_123_period_1786839387");
    expect(started.donationFrequency).toBe("MONTHLY");
    expect(started.eventKey).not.toBe(updated.eventKey);
    expect(bmcTransactionKeys(started.type, started.resourceId))
      .toEqual(bmcTransactionKeys(updated.type, updated.resourceId));
    expect(bmcTransactionKeys(started.type, started.resourceId))
      .not.toEqual(bmcTransactionKeys(nextMonth.type, nextMonth.resourceId));
  });

  it("normalizes BMC recurring subscription fields into a paid monthly event", () => {
    const event = parseBmcWebhook(JSON.stringify({
      event_id: 991,
      type: "recurring_donation.started",
      live_mode: true,
      created: 1786838400,
      attempt: 1,
      data: {
        subscription_id: 12345,
        transaction_id: "sub_provider_123",
        subscription_coffee_price: "6.000",
        subscription_coffee_num: 1,
        subscription_currency: "USD",
        subscription_message: "PZP-BMC-ABCD-1234-EFGH-5678",
        subscription_created_on: "2026-08-16T00:00:00Z",
        payer_name: "Monthly Donor",
        payer_email: "donor@example.com",
      },
    }));

    expect(event.resourceId).toBe("sub_provider_123");
    expect(event.supporterId).toBe("12345");
    expect(event.supporterName).toBe("Monthly Donor");
    expect(event.supporterEmail).toBe("donor@example.com");
    expect(event.amount).toBe(6);
    expect(event.currency).toBe("USD");
    expect(event.note).toBe("PZP-BMC-ABCD-1234-EFGH-5678");
    expect(event.donationFrequency).toBe("MONTHLY");
    expect(event.occurredAt.toISOString()).toBe("2026-08-16T00:00:00.000Z");
  });

  it("recognizes monthly autopay from BMC object and duration fields", () => {
    const event = parseBmcWebhook(JSON.stringify({
      event_id: 992,
      type: "donation.created",
      live_mode: true,
      data: {
        id: 123,
        object: "recurring_donation",
        duration_type: "month",
        psp_id: "sub_provider_992",
        amount: 6,
        currency: "USD",
      },
    }));

    expect(event.donationFrequency).toBe("MONTHLY");
  });
});
