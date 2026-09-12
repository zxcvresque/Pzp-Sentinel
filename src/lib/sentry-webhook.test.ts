import { createHmac } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), getDonation: vi.fn() }));
vi.mock("./donor-bridge", () => ({ bridgePool: { query: mocks.query } }));
vi.mock("./donor-bridge-donations", () => ({ getDonation: mocks.getDonation }));
import { drainSentryWebhooks, queueWebhookTest, webhookConfig, webhookHeaders } from "./sentry-webhook";

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
  mocks.query.mockResolvedValueOnce({ rows: [{ id: "event1", transactionId: "tx1", createdAt: new Date(), attempts: 1, body: null }] });
  mocks.getDonation.mockResolvedValue({ transactionId: "tx1", state: "REVERSED", lifecycle: "VOIDED" });
  await drainSentryWebhooks(1);
  const request = fetcher.mock.calls[0][1];
  expect(request).toMatchObject({ method: "POST", redirect: "manual" });
  expect(JSON.parse(request.body)).toMatchObject({ id: "event1", type: "donation.changed", donation: { state: "REVERSED", lifecycle: "VOIDED" } });
  expect(mocks.query.mock.calls[2][0]).toContain('"deliveredAt" = now()');
});
it.each([302, 429, 500])("retries HTTP %i with unchanged ID/body and no redirects", async status => {
  const body = JSON.stringify({ id: "retry1", type: "donation.changed" });
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }));
  vi.stubGlobal("fetch", fetcher);
  mocks.query.mockResolvedValueOnce({ rows: [{ id: "retry1", transactionId: "tx1", createdAt: new Date(), attempts: 2, body }] });
  await drainSentryWebhooks(1);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ body, redirect: "manual" });
  expect(mocks.getDonation).not.toHaveBeenCalled();
  expect(mocks.query.mock.calls[1][1].slice(0, 3)).toEqual([10, `Receiver HTTP ${status}`, "retry1"]);
});
it("sends unavailability for a removed or newly ineligible payment", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  mocks.query.mockResolvedValueOnce({ rows: [{ id: "event1", transactionId: "tx1", createdAt: new Date(), attempts: 1, body: null }] });
  mocks.getDonation.mockResolvedValue(null);
  await drainSentryWebhooks(1);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ type: "donation.unavailable", transactionId: "tx1", donation: null });
});
it("leaves the queue untouched when delivery is disabled", async () => {
  vi.stubEnv("SENTRY_WEBHOOK_URL", "");
  await drainSentryWebhooks();
  expect(mocks.query).not.toHaveBeenCalled();
});
