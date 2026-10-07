import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  order: vi.fn(), captured: vi.fn(), byPayment: vi.fn(), byOrder: vi.fn(), signature: vi.fn(),
  findReceipt: vi.fn(), saveReceipt: vi.fn(), updateReceipt: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {
  razorpayOrder: { findUnique: mocks.order },
  razorpayWebhookEvent: { findUnique: mocks.findReceipt, upsert: mocks.saveReceipt, update: mocks.updateReceipt },
} }));
vi.mock("@/lib/razorpay", () => ({
  finalizeCapturedDonation: mocks.captured,
  finalizeCapturedPaymentByReference: mocks.byPayment,
  finalizeCapturedOrderPayments: mocks.byOrder,
  finalizeMonthlySubscriptionCharge: vi.fn(), handleRazorpaySubscriptionLifecycle: vi.fn(),
  verifyWebhookSignature: mocks.signature,
  RazorpayError: class extends Error { constructor(message: string, public status = 500) { super(message); } },
}));
vi.mock("@/lib/secret-crypto", () => ({ encryptSecret: () => "encrypted-receipt" }));
import { POST } from "../app/api/webhooks/razorpay/route";
function request(event: string, payload: unknown) {
  return new NextRequest("https://sentinel.test/api/webhooks/razorpay", {
    method: "POST", headers: { "x-razorpay-signature": "signed", "x-razorpay-event-id": "event_1" },
    body: JSON.stringify({ event, payload }),
  });
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.signature.mockReturnValue(true);
  mocks.byPayment.mockResolvedValue({ matched: true }); mocks.byOrder.mockResolvedValue({ matched: true });
});
it("records a captured netbanking webhook through the same verified order path as other methods", async () => {
  mocks.order.mockResolvedValue({ id: "local-order" });
  expect((await POST(request("payment.captured", { payment: { entity: { id: "pay_1", order_id: "order_1", method: "netbanking" } } }))).status).toBe(200);
  expect(mocks.captured).toHaveBeenCalledWith({ orderId: "order_1", paymentId: "pay_1", actorName: "Razorpay webhook" });
});
it("recovers a payment-only capture rather than silently acknowledging it", async () => {
  expect((await POST(request("payment.captured", { payment: { entity: { id: "pay_1" } } }))).status).toBe(200);
  expect(mocks.byPayment).toHaveBeenCalledWith("pay_1");
  expect(mocks.updateReceipt).toHaveBeenCalledWith({ where: { eventId: "event_1" }, data: { status: "PROCESSED" } });
});
it("recovers an order-only paid webhook from the provider order payments API", async () => {
  expect((await POST(request("order.paid", { order: { entity: { id: "order_1" } } }))).status).toBe(200);
  expect(mocks.byOrder).toHaveBeenCalledWith("order_1");
});
it("keeps unmatched and incomplete captures visible in reconciliation", async () => {
  mocks.byPayment.mockResolvedValue({ matched: false });
  await POST(request("payment.captured", { payment: { entity: { id: "pay_1" } } }));
  expect(mocks.updateReceipt.mock.calls[0][0].data.status).toBe("UNMATCHED");
  await POST(request("order.paid", {}));
  expect(mocks.updateReceipt.mock.calls[1][0].data.status).toBe("UNMATCHED");
});
it("retains a durable receipt and returns failure when the provider verification fails", async () => {
  mocks.byPayment.mockRejectedValue(new Error("Temporary API outage"));
  expect((await POST(request("payment.captured", { payment: { entity: { id: "pay_1" } } }))).status).toBe(500);
  expect(mocks.saveReceipt.mock.calls[0][0].create).toMatchObject({ encryptedPayload: "encrypted-receipt", status: "RECEIVED", resourceId: "pay_1" });
  expect(mocks.updateReceipt).not.toHaveBeenCalled();
});
it("rejects unsigned events before creating receipts or recording payments", async () => {
  mocks.signature.mockReturnValue(false);
  expect((await POST(request("payment.captured", { payment: { entity: { id: "pay_1" } } }))).status).toBe(401);
  expect(mocks.saveReceipt).not.toHaveBeenCalled();
  expect(mocks.byPayment).not.toHaveBeenCalled();
});
