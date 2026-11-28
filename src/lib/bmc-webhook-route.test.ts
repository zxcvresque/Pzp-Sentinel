import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  findReceipt: vi.fn(), createReceipt: vi.fn(), updateReceipt: vi.fn(), findTransaction: vi.fn(),
  createTransaction: vi.fn(), transaction: vi.fn(), raw: vi.fn(), admin: vi.fn(), supporter: vi.fn(), notifyAdmins: vi.fn(), notify: vi.fn(), requestCheck: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {
  user: { findFirst: mocks.admin },
  $transaction: mocks.transaction,
  transaction: { findFirst: mocks.findTransaction, create: mocks.createTransaction },
  bmcWebhookEvent: { findUnique: mocks.findReceipt, create: mocks.createReceipt, update: mocks.updateReceipt },
  bmcSupporterLink: { findUnique: mocks.supporter },
} }));
vi.mock("@/lib/bmc-webhook", async importOriginal => ({ ...await importOriginal<typeof import("./bmc-webhook")>(), verifyBmcSignature: () => true }));
vi.mock("@/lib/notifications", () => ({ notify: mocks.notify, notifyAdmins: mocks.notifyAdmins, formatTgMessage: () => "message" }));
vi.mock("@/lib/finance-sheets", () => ({ scheduleFinanceAutomation: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/telegram-log", () => ({ logTransaction: vi.fn() }));
vi.mock("@/lib/donation-announcement", () => ({ announceDonationTransaction: vi.fn() }));
vi.mock("@/lib/secret-crypto", () => ({ encryptSecret: () => "encrypted-receipt" }));
vi.mock("@/lib/bmc-history-sync", () => ({ requestBmcHistoryCheck: mocks.requestCheck }));
import { POST } from "../app/api/bmc/webhook/route";
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("BMC_WEBHOOK_SECRET", "test-secret");
  mocks.admin.mockResolvedValue({ id: "admin" });
  mocks.createReceipt.mockResolvedValue({ id: "receipt" });
  mocks.transaction.mockImplementation(async run => run({ $queryRaw: mocks.raw,
    transaction: { findFirst: mocks.findTransaction, create: mocks.createTransaction }, bmcSupporterLink: { findUnique: mocks.supporter } }));
});
function request(type: string, data: Record<string, unknown>) {
  return new NextRequest("https://sentinel.test/api/bmc/webhook", { method: "POST", body: JSON.stringify({ event_id: 123, type, live_mode: true, data }) });
}
it.each(["recurring_donation.started", "recurring_donation.updated", "membership.started", "membership.updated"])("acknowledges signed %s lifecycle updates without recording income or thanking the donor", async type => {
  const response = await POST(request(type, { id: 1, psp_id: "sub_unpaid", status: "active", amount: 25, current_period_start: 1793266334 }));
  expect(response.status).toBe(200);
  expect(mocks.createTransaction).not.toHaveBeenCalled();
  expect(mocks.notify).not.toHaveBeenCalled();
  expect(mocks.notifyAdmins).toHaveBeenCalledOnce();
  expect(mocks.updateReceipt).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ processedAt: expect.any(Date) }) }));
});
it("retains failed payment evidence without adding a captured transaction", async () => {
  const response = await POST(request("donation.created", { id: 1, status: "failed", amount: 25 }));
  expect(await response.json()).toMatchObject({ status: "payment_unconfirmed", transactionId: null });
  expect(mocks.createTransaction).not.toHaveBeenCalled();
});

it("returns the history-owned ledger entry for a later webhook without creating or announcing another payment", async () => {
  mocks.findTransaction.mockResolvedValue({ id: "existing", fromUserId: "donor", fromUser: { telegramId: "574705248" }, bmcHistoryPaymentId: "pi_paid" });
  const response = await POST(request("donation.created", { id: 16287848, status: "succeeded", amount: 5, transaction_id: "pi_paid", currency: "USD" }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ transactionId: "existing", status: "duplicate_resource" });
  expect(mocks.createTransaction).not.toHaveBeenCalled();
  expect(mocks.notify).not.toHaveBeenCalled();
  expect(mocks.notifyAdmins).not.toHaveBeenCalled();
  expect(JSON.stringify(mocks.findTransaction.mock.calls)).toContain('"bmcHistoryPaymentId":"pi_paid"');
  expect(mocks.raw.mock.calls[0][0].join("")).toContain("pg_advisory_xact_lock(hashtext('sentinel-bmc-history'))");
});

it("holds a reference-free webhook near the same Telegram donor's payment without guessing it is new or a duplicate", async () => {
  mocks.findTransaction.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "nearby-charge" });
  mocks.supporter.mockResolvedValue({ userId: "donor" });
  const response = await POST(request("donation.created", { id: 16287848, supporter_id: 9, status: "succeeded", amount: 5, currency: "USD" }));
  expect(await response.json()).toMatchObject({ status: "payment_review_required", transactionId: null });
  expect(mocks.createTransaction).not.toHaveBeenCalled();
  expect(mocks.notify).not.toHaveBeenCalled();
  expect(mocks.notifyAdmins).toHaveBeenCalledOnce();
  expect(mocks.findTransaction.mock.calls[1][0].where).toMatchObject({ fromUserId: "donor", method: "BMC" });
});

it("starts a BMC history check for signed live activity, never for test-mode events", async () => {
  await POST(request("recurring_donation.updated", { id: 1, psp_id: "sub_live", status: "active", amount: 6 }));
  expect(mocks.requestCheck).toHaveBeenCalledOnce();
  mocks.requestCheck.mockClear();
  await POST(new NextRequest("https://sentinel.test/api/bmc/webhook", { method: "POST", body: JSON.stringify({ event_id: 124, type: "donation.created", live_mode: false, data: { id: 2 } }) }));
  expect(mocks.requestCheck).not.toHaveBeenCalled();
});
