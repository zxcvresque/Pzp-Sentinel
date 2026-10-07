import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    razorpayOrder: { findUnique: vi.fn(), updateMany: vi.fn() },
    transaction: { findUnique: vi.fn(), create: vi.fn() },
    razorpaySubscription: { findMany: vi.fn(), findFirst: vi.fn() },
    razorpayWebhookEvent: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    oneTimeDonationInvite: { findFirst: vi.fn(), update: vi.fn() },
    user: { update: vi.fn() },
    $transaction: vi.fn(),
  },
  fetch: vi.fn(), announce: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: mocks.db }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/telegram-log", () => ({ logTransaction: vi.fn() }));
vi.mock("@/lib/github-log", () => ({ logTransaction: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notify: vi.fn(async () => {}), notifyAdmins: vi.fn(async () => {}), formatTgMessage: vi.fn() }));
vi.mock("@/lib/donation-announcement", () => ({ announceDonationTransaction: mocks.announce }));
vi.mock("@/lib/finance-sheets", () => ({ scheduleFinanceAutomation: vi.fn() }));
vi.mock("@/lib/secret-crypto", () => ({ encryptSecret: (value: string) => `encrypted:${value}` }));
import { finalizeCapturedDonation, finalizeCapturedOrderPayments, finalizeCapturedPaymentByReference, reconcileRecentRazorpaySubscriptionPayments } from "./razorpay";

const payment = (overrides = {}) => ({ id: "pay_1", order_id: "order_1", amount: 50100, currency: "INR", status: "captured", captured: true, method: "netbanking", bank: "HDFC", ...overrides });
const order = (overrides = {}) => ({
  id: "local-order", razorpayOrderId: "order_1", amount: 50100, currency: "INR", description: "Donation", status: "CREATED", donationFrequency: "ONE_TIME", testMode: false,
  userId: "donor", user: { id: "donor", name: "Donor", telegramId: "12345", telegramUser: "donor" }, transaction: null, inviteId: null,
  ...overrides,
});
const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_key"); vi.stubEnv("RAZORPAY_KEY_SECRET", "secret");
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.db.razorpayOrder.findUnique.mockResolvedValue(order());
  mocks.db.razorpayOrder.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.transaction.findUnique.mockResolvedValue(null);
  mocks.db.transaction.create.mockImplementation(async ({ data }) => ({ ...data, id: "tx_1" }));
  mocks.db.razorpaySubscription.findMany.mockResolvedValue([]);
  mocks.db.razorpaySubscription.findFirst.mockResolvedValue(null);
  mocks.db.razorpayWebhookEvent.findMany.mockResolvedValue([]);
  mocks.db.$transaction.mockImplementation((action) => action(mocks.db));
  mocks.fetch.mockImplementation(async (url: string) => json(url.includes("/payments?") ? { items: [] } : payment()));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("method-independent Razorpay finalization", () => {
  it.each(["netbanking", "upi", "card", "wallet", "emi", "paylater", "bank_transfer"])("records verified %s captures", async (method) => {
    mocks.fetch.mockResolvedValue(json(payment({ method })));
    const result = await finalizeCapturedDonation({ orderId: "order_1", paymentId: "pay_1" });
    expect(result.transaction).toMatchObject({ amount: "501.00", method: "RAZORPAY", providerPaymentId: "pay_1", status: "APPROVED", providerVerified: true });
    expect(result.duplicate).toBe(false);
    if (method === "netbanking") expect(result.transaction.paymentMethodDetail).toBe("netbanking:hdfc");
  });
  it.each([{ amount: 1 }, { currency: "USD" }, { order_id: "order_other" }, { id: "pay_other" }])("rejects tampered or unrelated payment details", async (overrides) => {
    mocks.fetch.mockResolvedValue(json(payment(overrides)));
    await expect(finalizeCapturedDonation({ orderId: "order_1", paymentId: "pay_1" })).rejects.toThrow("do not match");
    expect(mocks.db.transaction.create).not.toHaveBeenCalled();
  });
  it.each(["authorized", "failed", "created", "refunded"])("does not treat %s as collected money", async (status) => {
    mocks.fetch.mockResolvedValue(json(payment({ status, captured: false })));
    await expect(finalizeCapturedDonation({ orderId: "order_1", paymentId: "pay_1" })).rejects.toThrow("not captured");
    expect(mocks.db.transaction.create).not.toHaveBeenCalled();
  });
  it("records a late bank capture on an expired or revoked guest invitation", async () => {
    mocks.db.razorpayOrder.findUnique.mockResolvedValue(order({ status: "EXPIRED", userId: null, user: null, inviteId: "invite", invite: { guestName: "Guest", telegramId: "12345", createdById: "admin", expiresAt: new Date(0), revokedAt: new Date(1), createdBy: { name: "Admin" } } }));
    expect((await finalizeCapturedDonation({ orderId: "order_1", paymentId: "pay_1" })).transaction.providerPaymentId).toBe("pay_1");
    expect(mocks.db.oneTimeDonationInvite.findFirst).not.toHaveBeenCalled();
    expect(mocks.db.razorpayOrder.updateMany.mock.calls[0][0].where).not.toHaveProperty("status");
  });
  it("does not duplicate an already recorded capture", async () => {
    mocks.db.razorpayOrder.findUnique.mockResolvedValue(order({ transaction: { id: "tx_existing", providerPaymentId: "pay_1" } }));
    expect((await finalizeCapturedDonation({ orderId: "order_1", paymentId: "pay_1" })).duplicate).toBe(true);
    expect(mocks.db.transaction.create).not.toHaveBeenCalled();
  });
  it("uses the provider order reference when a webhook contains only the payment ID", async () => {
    expect((await finalizeCapturedPaymentByReference("pay_1")).matched).toBe(true);
    expect(mocks.db.transaction.create.mock.calls[0][0].data.providerPaymentId).toBe("pay_1");
  });
  it("uses the order payments API when order.paid omits the payment entity", async () => {
    mocks.fetch.mockImplementation(async (url: string) => json(url.includes("/orders/") ? { items: [payment()] } : payment()));
    expect(await finalizeCapturedOrderPayments("order_1")).toEqual({ matched: true, recovered: 1 });
  });
  it("reads the complete order collection once even with 100 failed attempts", async () => {
    mocks.fetch.mockImplementation(async (url: string) => json(url.includes("/orders/") ? { items: [...Array.from({ length: 100 }, () => payment({ status: "failed", captured: false })), payment()] } : payment()));
    expect(await finalizeCapturedOrderPayments("order_1")).toEqual({ matched: true, recovered: 1 });
    expect(mocks.fetch.mock.calls.filter(([url]) => String(url).includes("/orders/"))).toHaveLength(1);
  });
  it("leaves an order receipt retryable when capture has not reached the API", async () => {
    mocks.fetch.mockResolvedValue(json({ items: [] }));
    await expect(finalizeCapturedOrderPayments("order_1")).rejects.toMatchObject({ status: 409 });
    expect(mocks.db.transaction.create).not.toHaveBeenCalled();
  });
});

describe("Razorpay scheduled recovery", () => {
  it("recovers captured netbanking without a browser callback or webhook", async () => {
    mocks.fetch.mockImplementation(async (url: string) => json(url.includes("/payments?") ? { items: [payment()] } : payment()));
    expect(await reconcileRecentRazorpaySubscriptionPayments()).toMatchObject({ recovered: 1, errors: [] });
    const scan = new URL(mocks.fetch.mock.calls[0][0]);
    expect(scan.searchParams.get("to")).toMatch(/^\d+$/);
    expect(scan.searchParams.has("method")).toBe(false);
  });
  it("retries durable receipt IDs beyond the scan window even when the collection API fails", async () => {
    mocks.db.razorpayWebhookEvent.findMany.mockResolvedValue([{ eventId: "event_old", resourceId: "pay_1" }]);
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.includes("/payments?")) throw new Error("Collection unavailable");
      return json(payment());
    });
    const result = await reconcileRecentRazorpaySubscriptionPayments();
    expect(result.recovered).toBe(1);
    expect(result.errors[0]).toContain("Payment scan");
    expect(mocks.db.razorpayWebhookEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "PROCESSED" } }));
  });
  it("continues recovering other payments after one fails verification", async () => {
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.includes("/payments?")) return json({ items: [payment({ id: "pay_bad" }), payment()] });
      return json(payment(url.endsWith("pay_bad") ? { id: "pay_bad", amount: 10 } : {}));
    });
    const result = await reconcileRecentRazorpaySubscriptionPayments();
    expect(result.recovered).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
});
