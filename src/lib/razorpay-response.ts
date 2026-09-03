export type RazorpayProviderPayload = {
  error?: {
    code?: string;
    description?: string;
    reason?: string;
    source?: string;
    step?: string;
  };
};

export function parseRazorpayPayload(body: string): unknown {
  if (!body.trim()) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export function razorpayProviderError(status: number, payload: unknown) {
  const providerError = payload && typeof payload === "object" && "error" in payload
    ? (payload as RazorpayProviderPayload).error
    : undefined;
  const description = providerError?.description?.trim();

  if (description) {
    return {
      message: `${description} (Razorpay HTTP ${status})`,
      code: providerError?.code,
      reason: providerError?.reason,
      source: providerError?.source,
      step: providerError?.step,
    };
  }

  const message = status === 401 || status === 403
    ? "Razorpay rejected Sentinel's deployed API credentials. An admin must verify the production key ID and secret"
    : status === 429
      ? "Razorpay is rate-limiting checkout requests. Please wait briefly and try again"
      : status >= 500
        ? "Razorpay is temporarily unavailable. Please try again shortly"
        : "Razorpay rejected the checkout request";

  return {
    message: `${message} (Razorpay HTTP ${status})`,
    code: providerError?.code,
    reason: providerError?.reason,
    source: providerError?.source,
    step: providerError?.step,
  };
}
