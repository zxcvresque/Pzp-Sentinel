import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), status: vi.fn(), config: vi.fn(), queue: vi.fn(), drain: vi.fn(), after: vi.fn() }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/donor-bridge", () => ({ bridgeAuthorized: mocks.auth }));
vi.mock("@/lib/sentry-webhook", () => ({ webhookStatus: mocks.status, webhookConfig: mocks.config, queueWebhookTest: mocks.queue, drainSentryWebhooks: mocks.drain }));
import { GET, POST } from "../app/api/sentry-bridge/webhook/route";
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockReturnValue(true); mocks.config.mockReturnValue({}); mocks.queue.mockResolvedValue("id1"); });
it("requires authentication before reading status or sending a test", async () => {
  mocks.auth.mockReturnValue(false);
  expect((await GET(new Request("https://example.test"))).status).toBe(401);
  expect((await POST(new Request("https://example.test", { method: "POST" }))).status).toBe(401);
  expect(mocks.queue).not.toHaveBeenCalled();
});
it("queues the sample only after an HTTPS destination is configured", async () => {
  const request = () => new Request("https://example.test", { method: "POST", body: JSON.stringify({ action: "test", telegramId: "5988446905" }) });
  mocks.config.mockReturnValue(null);
  expect((await POST(request())).status).toBe(503);
  expect(mocks.queue).not.toHaveBeenCalled();
  mocks.config.mockReturnValue({});
  const response = await POST(request());
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({ eventId: "id1", paymentCreated: false });
  expect(mocks.queue).toHaveBeenCalledWith("5988446905");
  expect(mocks.after).toHaveBeenCalledOnce();
});
it("rejects attempts to create payments via the test endpoint", async () => {
  const response = await POST(new Request("https://example.test", { method: "POST", body: JSON.stringify({ action: "pay", amount: 1 }) }));
  expect(response.status).toBe(400);
  expect(mocks.queue).not.toHaveBeenCalled();
});
