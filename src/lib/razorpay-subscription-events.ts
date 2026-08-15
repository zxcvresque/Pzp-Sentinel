export type RazorpaySubscriptionWebhookEntity = {
  id?: string;
  status?: string;
  paid_count?: number;
  remaining_count?: number;
  charge_at?: number | null;
  ended_at?: number | null;
  cancel_initiated_by?: string | null;
  pause_initiated_by?: string | null;
};

export type NormalizedRazorpaySubscriptionEvent = {
  event: string;
  action: string;
  subscriptionId: string;
  status: string;
  paidCount?: number;
  remainingCount?: number;
  nextChargeAt?: Date | null;
  endedAt?: Date | null;
  cancelInitiatedBy?: string | null;
  pauseInitiatedBy?: string | null;
};

export type SubscriptionAlertPolicy = {
  donor: boolean;
  admins: boolean;
  priority: "NORMAL" | "HIGH";
};

function integer(value: unknown) {
  return Number.isInteger(value) ? value as number : undefined;
}

function nullableText(value: unknown) {
  if (value === null) return null;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nullableUnixDate(value: unknown) {
  if (value === null) return null;
  const seconds = integer(value);
  return seconds === undefined ? undefined : new Date(seconds * 1000);
}

export function normalizeRazorpaySubscriptionEvent(
  event: string,
  entity?: RazorpaySubscriptionWebhookEntity,
): NormalizedRazorpaySubscriptionEvent | null {
  if (!event.startsWith("subscription.") || !entity?.id) return null;
  const action = event.slice("subscription.".length).toLowerCase();
  return {
    event,
    action,
    subscriptionId: entity.id,
    status: (entity.status || action || "updated").toUpperCase(),
    paidCount: integer(entity.paid_count),
    remainingCount: integer(entity.remaining_count),
    nextChargeAt: nullableUnixDate(entity.charge_at),
    endedAt: nullableUnixDate(entity.ended_at),
    cancelInitiatedBy: nullableText(entity.cancel_initiated_by),
    pauseInitiatedBy: nullableText(entity.pause_initiated_by),
  };
}

export function subscriptionAlertPolicy(action: string): SubscriptionAlertPolicy {
  switch (action.toLowerCase()) {
    case "cancelled":
    case "halted":
      return { donor: true, admins: true, priority: "HIGH" };
    case "paused":
    case "resumed":
    case "activated":
    case "completed":
    case "expired":
      return { donor: true, admins: true, priority: "NORMAL" };
    case "pending":
      return { donor: true, admins: false, priority: "NORMAL" };
    default:
      return { donor: false, admins: false, priority: "NORMAL" };
  }
}

export function feedbackChoiceTransition(step: "wanted" | "cancelled", answer: boolean) {
  if (step === "wanted" && !answer) {
    return {
      stage: "ASK_CANCELLED" as const,
      data: { wantedToDonate: false },
      prompt: "Did you deliberately cancel or stop this autopay?",
    };
  }
  if (step === "wanted") {
    return {
      stage: "AWAITING_REASON" as const,
      data: { wantedToDonate: true },
      prompt: "What prevented the payment even though you wanted to continue donating? Please reply with the reason.",
    };
  }
  return {
    stage: "AWAITING_REASON" as const,
    data: { deliberateCancellation: answer },
    prompt: answer
      ? "Please tell us why you decided to cancel the autopay."
      : "Please tell us what happened, so the admins can help if needed.",
  };
}

export function razorpayFeedbackKeyboard(feedbackId: string) {
  return {
    inline_keyboard: [[
      { text: "Yes", callback_data: `rzpfb:wanted:yes:${feedbackId}` },
      { text: "No", callback_data: `rzpfb:wanted:no:${feedbackId}` },
    ]],
  };
}
