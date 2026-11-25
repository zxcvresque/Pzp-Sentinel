import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  findReceipt: vi.fn(), createReceipt: vi.fn(), updateReceipt: vi.fn(), findTransaction: vi.fn(),
  createTransaction: vi.fn(), admin: vi.fn(), supporter: vi.fn(), notifyAdmins: vi.fn(), notify: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {
  user: { findFirst: mocks.admin },
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
import { POST } from "../app/api/bmc/webhook/route";
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("BMC_WEBHOOK_SECRET", "test-secret");
  mocks.admin.mockResolvedValue({ id: "admin" });
  mocks.createReceipt.mockResolvedValue({ id: "receipt" });
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
