import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { parseBmcWebhook, verifyBmcSignature } from "./bmc-webhook";

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
        support_note: "Keep building",
        created_at: 1719825600,
      },
    }));

    expect(event.type).toBe("donation.created");
    expect(event.resourceId).toBe("98765");
    expect(event.supporterName).toBe("Alex");
    expect(event.amount).toBe(15);
    expect(event.currency).toBe("USD");
    expect(event.note).toBe("Keep building");
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
});
