import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), save: vi.fn(), deliver: vi.fn(), after: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/bmc-feedback-service", () => ({ saveBmcFeedback: mocks.save, drainBmcFeedbackDelivery: mocks.deliver }));
vi.mock("next/server", () => ({ after: mocks.after }));
import { FeedbackError } from "./bmc-feedback-response";
import { POST } from "../app/api/bmc/feedback/[id]/route";
const context = { params: Promise.resolve({ id: "form" }) };
const request = (body: string) => new Request("https://sentinel.test/api/bmc/feedback/form", { method: "POST", body });
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: "signed-in-user" }); });
it("requires a signed-in user before accessing a response request", async () => {
  mocks.user.mockResolvedValue(null);
  expect((await POST(request("{}"), context)).status).toBe(401);
  expect(mocks.save).not.toHaveBeenCalled();
});
it.each(["{", "null", "[]"])("rejects invalid body %s", async body => {
  expect((await POST(request(body), context)).status).toBe(400);
  expect(mocks.save).not.toHaveBeenCalled();
});
it("uses session identity and queues delivery after the response commits", async () => {
  expect((await POST(request('{"userId":"intruder","additionalInfo":"One addition"}'), context)).status).toBe(200);
  expect(mocks.save).toHaveBeenCalledWith({}, expect.objectContaining({ userId: "signed-in-user", source: "APP", id: "form" }));
  expect(mocks.after).toHaveBeenCalledOnce();
});
it("reports the one-addition limit without scheduling duplicate delivery", async () => {
  mocks.save.mockRejectedValue(new FeedbackError("Already added", 409));
  expect((await POST(request('{"additionalInfo":"Again"}'), context)).status).toBe(409);
  expect(mocks.after).not.toHaveBeenCalled();
});
