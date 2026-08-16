import { describe, expect, it } from "vitest";
import {
  feedbackChoiceTransition,
  normalizeRazorpaySubscriptionEvent,
  shouldFinalizeSubscriptionPayment,
  subscriptionAlertPolicy,
} from "./razorpay-subscription-events";

describe("Razorpay subscription lifecycle events", () => {
  it("retains cancellation metadata from a webhook payload", () => {
    const event = normalizeRazorpaySubscriptionEvent("subscription.cancelled", {
      id: "sub_monthly_123",
      status: "cancelled",
      paid_count: 1,
      remaining_count: 1199,
      charge_at: null,
      ended_at: 1_725_184_000,
      cancel_initiated_by: "customer",
    });

    expect(event).toMatchObject({
      action: "cancelled",
      subscriptionId: "sub_monthly_123",
      status: "CANCELLED",
      paidCount: 1,
      remainingCount: 1199,
      nextChargeAt: null,
      cancelInitiatedBy: "customer",
    });
    expect(event?.endedAt?.toISOString()).toBe("2024-09-01T09:46:40.000Z");
  });

  it("routes private alerts by lifecycle severity", () => {
    expect(subscriptionAlertPolicy("pending")).toEqual({ donor: true, admins: false, priority: "NORMAL" });
    expect(subscriptionAlertPolicy("paused")).toEqual({ donor: true, admins: true, priority: "NORMAL" });
    expect(subscriptionAlertPolicy("cancelled")).toEqual({ donor: true, admins: true, priority: "HIGH" });
    expect(subscriptionAlertPolicy("halted")).toEqual({ donor: true, admins: true, priority: "HIGH" });
    expect(subscriptionAlertPolicy("authenticated")).toEqual({ donor: false, admins: false, priority: "NORMAL" });
  });

  it("records a charged event and a paid authentication event as money", () => {
    const charged = normalizeRazorpaySubscriptionEvent("subscription.charged", {
      id: "sub_1",
      paid_count: 2,
    });
    const paidAuthentication = normalizeRazorpaySubscriptionEvent("subscription.authenticated", {
      id: "sub_2",
      paid_count: 1,
    });
    const mandateOnly = normalizeRazorpaySubscriptionEvent("subscription.authenticated", {
      id: "sub_3",
      paid_count: 0,
    });
    expect(shouldFinalizeSubscriptionPayment(charged, "pay_1")).toBe(true);
    expect(shouldFinalizeSubscriptionPayment(paidAuthentication, "pay_2")).toBe(true);
    expect(shouldFinalizeSubscriptionPayment(mandateOnly, "pay_3")).toBe(false);
  });

  it("rejects non-subscription payloads and accepts nullable provider fields", () => {
    expect(normalizeRazorpaySubscriptionEvent("payment.captured", { id: "sub_1" })).toBeNull();
    expect(normalizeRazorpaySubscriptionEvent("subscription.paused", {})).toBeNull();
    expect(normalizeRazorpaySubscriptionEvent("subscription.paused", {
      id: "sub_1",
      status: "paused",
      pause_initiated_by: null,
    })).toMatchObject({ status: "PAUSED", pauseInitiatedBy: null });
  });

  it("routes every donor answer to a reason while adding the deliberate-cancellation question", () => {
    expect(feedbackChoiceTransition("wanted", true)).toMatchObject({
      stage: "AWAITING_REASON",
      data: { wantedToDonate: true },
    });
    expect(feedbackChoiceTransition("wanted", false)).toMatchObject({
      stage: "ASK_CANCELLED",
      data: { wantedToDonate: false },
    });
    expect(feedbackChoiceTransition("cancelled", true)).toMatchObject({
      stage: "AWAITING_REASON",
      data: { deliberateCancellation: true },
    });
    expect(feedbackChoiceTransition("cancelled", false)).toMatchObject({
      stage: "AWAITING_REASON",
      data: { deliberateCancellation: false },
    });
  });
});
