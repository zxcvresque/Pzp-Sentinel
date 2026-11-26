import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ transactions: vi.fn(), feedback: vi.fn() }));
vi.mock("./db", () => ({ prisma: { transaction: { findMany: mocks.transactions }, bmcSubscriptionFeedback: { findMany: mocks.feedback } } }));
import { notificationTargets, safeNotificationPath } from "./notification-routing";
const admin = { id: "admin", roles: ["ADMIN"] };
const notification = { id: "n", type: "SYSTEM", entityId: "payment", title: "Razorpay monthly donation captured", actionUrl: null };
beforeEach(() => { vi.clearAllMocks(); mocks.transactions.mockResolvedValue([]); mocks.feedback.mockResolvedValue([]); });

it("sends old SYSTEM donation notifications directly to their exact transaction, including voided entries", async () => {
  mocks.transactions.mockResolvedValue([{ id: "payment" }]);
  const targets = await notificationTargets([notification], admin);
  expect(targets.get("n")).toBe("/admin/transactions?transactionId=payment&lifecycle=ALL");
  expect(mocks.transactions.mock.calls[0][0].where).not.toHaveProperty("voidedAt");
});
it("resolves the entity before a broad saved action URL", async () => {
  mocks.transactions.mockResolvedValue([{ id: "payment" }]);
  expect((await notificationTargets([{ ...notification, actionUrl: "/admin/transactions" }], admin)).get("n")).toContain("transactionId=payment");
});
it("opens a saved BMC response directly without an intermediate message summary", async () => {
  mocks.feedback.mockResolvedValue([{ id: "form" }]);
  expect((await notificationTargets([{ ...notification, entityId: "form" }], admin)).get("n")).toBe("/notifications/feedback/form");
});
it("limits donor entity lookups to their own records and opens their payment history", async () => {
  mocks.transactions.mockResolvedValue([{ id: "payment" }]);
  expect((await notificationTargets([notification], { id: "donor", roles: ["DONOR"] })).get("n")).toBe("/donor?transactionId=payment&lifecycle=ALL");
  expect(mocks.transactions).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["payment"] }, fromUserId: "donor" } }));
  expect(mocks.feedback).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["payment"] }, userId: "donor" } }));
});
it("keeps ordinary messages readable and rejects external action destinations", async () => {
  for (const path of ["https://evil.test", "//evil.test", "/\\evil.test", "/profile\n"]) expect(safeNotificationPath(path)).toBeNull();
  expect((await notificationTargets([{ ...notification, actionUrl: "//evil.test" }], admin)).get("n")).toBe("/notifications/n");
});
it("preserves valid resource links and does no entity queries for broadcasts", async () => {
  expect((await notificationTargets([{ ...notification, entityId: null, actionUrl: "/profile" }], admin)).get("n")).toBe("/profile");
  expect(mocks.transactions).not.toHaveBeenCalled();
});
