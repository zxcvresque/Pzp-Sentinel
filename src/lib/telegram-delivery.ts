type TelegramErrorLike = {
  error_code?: number;
  status?: number;
  statusCode?: number;
  code?: string;
  description?: string;
  message?: string;
  parameters?: { retry_after?: number };
  error?: unknown;
  cause?: unknown;
};

export type TelegramDeliveryResult =
  | { status: "SENT"; attempts: number }
  | { status: "FAILED"; attempts: number; error: unknown; errorMessage: string };

function errorCandidates(error: unknown): TelegramErrorLike[] {
  if (!error || typeof error !== "object") return [];
  const candidate = error as TelegramErrorLike;
  return [candidate, candidate.error, candidate.cause]
    .filter((value): value is TelegramErrorLike => Boolean(value) && typeof value === "object");
}

export function telegramDeliveryErrorMessage(error: unknown): string {
  const messages = errorCandidates(error)
    .flatMap((candidate) => [candidate.description, candidate.message])
    .filter((value): value is string => Boolean(value));
  return (messages[0] ?? (error instanceof Error ? error.message : String(error))).slice(0, 1000);
}

export function isTransientTelegramDeliveryError(error: unknown): boolean {
  return errorCandidates(error).some((candidate) => {
    const status = candidate.error_code ?? candidate.status ?? candidate.statusCode;
    const message = `${candidate.description ?? ""} ${candidate.message ?? ""}`;
    return status === 429
      || (typeof status === "number" && status >= 500)
      || ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH", "EAI_AGAIN"].includes(candidate.code ?? "")
      || /gateway timeout|network error|fetch failed|socket hang up/i.test(message);
  });
}

export function isPermanentTelegramRecipientError(error: unknown): boolean {
  return errorCandidates(error).some((candidate) => {
    const status = candidate.error_code ?? candidate.status ?? candidate.statusCode;
    const message = `${candidate.description ?? ""} ${candidate.message ?? ""}`;
    return status === 403 && /bot was blocked|user is deactivated|chat not found/i.test(message);
  });
}

function retryDelayMs(error: unknown, attempt: number): number {
  for (const candidate of errorCandidates(error)) {
    const retryAfter = candidate.parameters?.retry_after;
    if (typeof retryAfter === "number" && retryAfter > 0) return retryAfter * 1_000;
  }
  return 500 * 2 ** (attempt - 1);
}

async function runTrackingHook(
  hook: (() => void | Promise<void>) | undefined,
  onTrackingError: ((error: unknown) => void) | undefined,
) {
  if (!hook) return;
  try {
    await hook();
  } catch (error) {
    onTrackingError?.(error);
  }
}

/**
 * Send a Telegram message with bounded retries while keeping delivery state in
 * the caller's durable notification record. Tracking failures never suppress
 * the actual DM attempt.
 */
export async function deliverTelegramWithRetry(options: {
  send: () => Promise<unknown>;
  maxAttempts?: number;
  onAttempt?: (attempt: number) => void | Promise<void>;
  onSent?: (attempts: number) => void | Promise<void>;
  onFailed?: (error: unknown, attempts: number, errorMessage: string) => void | Promise<void>;
  onTrackingError?: (error: unknown) => void;
  wait?: (milliseconds: number) => Promise<void>;
}): Promise<TelegramDeliveryResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const wait = options.wait ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let lastError: unknown;
  let attempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;
    await runTrackingHook(() => options.onAttempt?.(attempt), options.onTrackingError);
    try {
      await options.send();
      await runTrackingHook(() => options.onSent?.(attempt), options.onTrackingError);
      return { status: "SENT", attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts && isTransientTelegramDeliveryError(error)) {
        await wait(retryDelayMs(error, attempt));
        continue;
      }
      break;
    }
  }

  const errorMessage = telegramDeliveryErrorMessage(lastError);
  await runTrackingHook(
    () => options.onFailed?.(lastError, attempts, errorMessage),
    options.onTrackingError,
  );
  return { status: "FAILED", attempts, error: lastError, errorMessage };
}
