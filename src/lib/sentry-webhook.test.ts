import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), getDonation: vi.fn(), summary: vi.fn() }));
vi.mock("./donor-bridge", () => ({ bridgePool: { query: mocks.query } }));
vi.mock("./donor-bridge-donations", () => ({ getDonation: mocks.getDonation, donorDonationSummary: mocks.summary, BmcUnverifiedError: class BmcUnverifiedError extends Error {} }));
import { drainSentryWebhooks, queueWebhookTest, webhookConfig, webhookHeaders } from "./sentry-webhook";
import { BmcUnverifiedError } from "./donor-bridge-donations";
// Each drain step: lease query, transaction-method lookup, then body save / delivery updates.
const lease = (job: object, method = "RAZORPAY") => {
  mocks.query.mockResolvedValueOnce({ rows: [job] }).mockResolvedValueOnce({ rows: [{ method }] });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SENTRY_WEBHOOK_URL", "https://receiver.example.test/sentinel");
  vi.stubEnv("SENTRY_WEBHOOK_SECRET", "x".repeat(64));
  mocks.query.mockResolvedValue({ rows: [], rowCount: 1 });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("encrypts transport and requires a configured secret", () => {
  vi.stubEnv("SENTRY_WEBHOOK_URL", "http://receiver.example.test/sentinel");
  expect(webhookConfig).toThrow("HTTPS");
  vi.stubEnv("SENTRY_WEBHOOK_URL", "https://user:password@receiver.example.test/sentinel");
  expect(webhookConfig).toThrow("HTTPS");
  vi.stubEnv("SENTRY_WEBHOOK_URL", "");
  expect(webhookConfig()).toBeNull();
});
it("signs timestamp and exact body, never transmits the shared key", () => {
  const body = '{"amount":"1"}', key = "secret", timestamp = "123";
  const headers = webhookHeaders(body, "event1", key, timestamp);
  expect(headers["X-Sentinel-Signature"]).toBe(`sha256=${createHmac("sha256", key).update("123." + body).digest("hex")}`);
  expect(JSON.stringify(headers)).not.toContain(key);
  expect(webhookHeaders(body + " ", "event1", key, timestamp)["X-Sentinel-Signature"]).not.toBe(headers["X-Sentinel-Signature"]);
});
it("queues a clearly marked USD test without querying or writing a donation", async () => {
  const id = await queueWebhookTest("5988446905");
  const body = JSON.parse(mocks.query.mock.calls[0][1][1]);
  expect(body).toMatchObject({ id, type: "webhook.test", donation: null, transactionId: null, test: { telegramId: "5988446905", amount: "1", currency: "USD" } });
  expect(mocks.query.mock.calls[0][0]).toContain('INSERT INTO "SentryWebhookDelivery"');
  expect(mocks.getDonation).not.toHaveBeenCalled();
});
it("posts the current void state, persists its payload and marks a 2xx delivered", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  lease({ id: "event1", transactionId: "tx1", createdAt: new Date(), attempts: 1, body: null });
  mocks.getDonation.mockResolvedValue({ transactionId: "tx1", state: "REVERSED", lifecycle: "VOIDED" });
  await drainSentryWebhooks(1);
  const request = fetcher.mock.calls[0][1];
  expect(request).toMatchObject({ method: "POST", redirect: "manual" });
  expect(JSON.parse(request.body)).toMatchObject({ id: "event1", type: "donation.changed", donation: { state: "REVERSED", lifecycle: "VOIDED" } });
  expect(mocks.query.mock.calls[3][0]).toContain('"deliveredAt" = now()');
});
it.each([302, 429, 500])("retries HTTP %i with unchanged ID/body and no redirects", async status => {
  const body = JSON.stringify({ id: "retry1", type: "donation.changed" });
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }));
  vi.stubGlobal("fetch", fetcher);
  lease({ id: "retry1", transactionId: "tx1", createdAt: new Date(), attempts: 2, body });
  await drainSentryWebhooks(1);
  // Same event ID and frozen facts on every retry; only the donor's current state is added.
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "manual", headers: { "X-Sentinel-Event-Id": "retry1" } });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ ...JSON.parse(body), schemaVersion: 2, sentAt: expect.any(String), donor: null });
  expect(mocks.getDonation).not.toHaveBeenCalled();
  expect(mocks.query.mock.calls[2][1].slice(0, 3)).toEqual([10, `Receiver HTTP ${status}`, "retry1"]);
});
it("sends unavailability for a removed or newly ineligible payment", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  lease({ id: "event1", transactionId: "tx1", createdAt: new Date(), attempts: 1, body: null });
  mocks.getDonation.mockResolvedValue(null);
  await drainSentryWebhooks(1);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ type: "donation.unavailable", transactionId: "tx1", donation: null });
});
it("leaves the queue untouched when delivery is disabled", async () => {
  vi.stubEnv("SENTRY_WEBHOOK_URL", "");
  await drainSentryWebhooks();
  expect(mocks.query).not.toHaveBeenCalled();
});

describe("BMC deliveries are verified publications only", () => {
  const superseded = () => mocks.query.mock.calls.find(([sql]) => String(sql).includes('"supersededAt" = now()'));
  it("suppresses a pre-gate frozen BMC payload instead of delivering unverified facts", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    lease({ id: "old", transactionId: "tx1", createdAt: new Date(), attempts: 3, body: JSON.stringify({ type: "donation.changed", donation: { provider: "bmc", state: "PAID" } }) }, "BMC");
    await drainSentryWebhooks(1);
    expect(fetcher).not.toHaveBeenCalled(); expect(superseded()?.[1][0]).toMatch(/not a verified publication/);
  });
  it("suppresses an unverified BMC payment rather than retrying or reporting it removed", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    lease({ id: "new", transactionId: "tx1", createdAt: new Date(), attempts: 1, body: null }, "BMC");
    mocks.getDonation.mockRejectedValue(new BmcUnverifiedError());
    await drainSentryWebhooks(1);
    expect(fetcher).not.toHaveBeenCalled(); expect(superseded()).toBeTruthy();
  });
  it("never sends donation.unavailable for an unpublished BMC row", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    lease({ id: "gone", transactionId: "tx1", createdAt: new Date(), attempts: 1, body: null }, "BMC");
    mocks.getDonation.mockResolvedValue(null);
    await drainSentryWebhooks(1);
    expect(fetcher).not.toHaveBeenCalled(); expect(superseded()).toBeTruthy();
  });
  it("delivers a verified publication", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal("fetch", fetcher);
    lease({ id: "ok", transactionId: "tx1", createdAt: new Date(), attempts: 1, body: null }, "BMC");
    mocks.getDonation.mockResolvedValue({ transactionId: "tx1", provider: "bmc", state: "PAID", verification: "BMC_COMPLETE_HISTORY" });
    await drainSentryWebhooks(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ donation: { verification: "BMC_COMPLETE_HISTORY" } });
  });
});

it("carries the donor's current summary and auto-XP, computed at send time, even on a late retry", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  const body = JSON.stringify({ id: "late1", schemaVersion: 1, type: "donation.changed", transactionId: "tx1", donation: { telegramId: "900000002", state: "PAID" } });
  lease({ id: "late1", transactionId: "tx1", createdAt: new Date("2026-11-01T00:00:00Z"), attempts: 4, body });
  const donor = { telegramId: "900000002", autoXp: { activeUntil: "2026-12-16T00:00:00.000Z", graceUntil: "2026-12-19T00:00:00.000Z" } };
  mocks.summary.mockResolvedValue(donor);
  await drainSentryWebhooks(1);
  expect(mocks.summary).toHaveBeenCalledWith("900000002");
  const sent = fetcher.mock.calls[0][1];
  expect(JSON.parse(sent.body)).toMatchObject({ id: "late1", schemaVersion: 2, donation: { state: "PAID" }, donor });
  // The signature covers exactly what was sent.
  const { "X-Sentinel-Timestamp": timestamp, "X-Sentinel-Signature": signature } = sent.headers;
  expect(signature).toBe(`sha256=${createHmac("sha256", "x".repeat(64)).update(`${timestamp}.${sent.body}`).digest("hex")}`);
});
