import { describe, expect, it, vi } from "vitest";
import {
  deliverTelegramWithRetry,
  isPermanentTelegramRecipientError,
  isTransientTelegramDeliveryError,
} from "./telegram-delivery";

describe("Telegram delivery", () => {
  it("retries transient failures and records every attempt before success", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce({ error_code: 503, description: "Service unavailable" })
      .mockResolvedValueOnce({ message_id: 1 });
    const attempts: number[] = [];
    const sent: number[] = [];

    const result = await deliverTelegramWithRetry({
      send,
      onAttempt: (attempt) => { attempts.push(attempt); },
      onSent: (attempt) => { sent.push(attempt); },
      wait: async () => undefined,
    });

    expect(result).toEqual({ status: "SENT", attempts: 2 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(attempts).toEqual([1, 2]);
    expect(sent).toEqual([2]);
  });

  it("does not retry permanent recipient failures and persists the reason", async () => {
    const failure = { error_code: 403, description: "Forbidden: bot was blocked by the user" };
    const failed = vi.fn();
    const send = vi.fn().mockRejectedValue(failure);

    const result = await deliverTelegramWithRetry({
      send,
      onFailed: failed,
      wait: async () => undefined,
    });

    expect(result).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith(failure, 1, failure.description);
    expect(isPermanentTelegramRecipientError(failure)).toBe(true);
  });

  it("honours Telegram retry-after responses", async () => {
    const waits: number[] = [];
    const send = vi.fn()
      .mockRejectedValueOnce({ error_code: 429, parameters: { retry_after: 3 } })
      .mockResolvedValueOnce({ message_id: 2 });

    await deliverTelegramWithRetry({
      send,
      wait: async (milliseconds) => { waits.push(milliseconds); },
    });

    expect(waits).toEqual([3_000]);
    expect(isTransientTelegramDeliveryError({ error_code: 429 })).toBe(true);
  });

  it("still sends when a delivery-state update fails", async () => {
    const send = vi.fn().mockResolvedValue({ message_id: 3 });
    const trackingErrors: unknown[] = [];

    const result = await deliverTelegramWithRetry({
      send,
      onAttempt: () => { throw new Error("database unavailable"); },
      onTrackingError: (error) => { trackingErrors.push(error); },
    });

    expect(result).toEqual({ status: "SENT", attempts: 1 });
    expect(send).toHaveBeenCalledOnce();
    expect(trackingErrors).toHaveLength(1);
  });
});
