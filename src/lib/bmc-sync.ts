export interface BmcLegacyPage<T> {
  current_page?: number;
  data?: T[];
  last_page?: number;
  error?: unknown;
}

export function bmcLegacyPageItems<T>(payload: BmcLegacyPage<T>, source: string): T[] {
  if (payload.error) {
    const detail = typeof payload.error === "string" ? payload.error : "provider returned an error";
    throw new Error(`${source}: ${detail}`);
  }
  if (!Array.isArray(payload.data)) {
    throw new Error(`${source}: invalid response shape`);
  }
  return payload.data;
}

/** Missing pagination metadata means the response is a single page. */
export function nextBmcLegacyPage(payload: BmcLegacyPage<unknown>, requestedPage: number): number | null {
  const lastPage = Number(payload.last_page);
  if (!Number.isInteger(lastPage) || lastPage <= requestedPage) return null;
  return requestedPage + 1;
}

export function bmcSubscriptionPaymentKey(subscriptionId: number | string, periodStart: string | Date) {
  const date = periodStart instanceof Date ? periodStart : new Date(periodStart);
  if (Number.isNaN(date.getTime())) throw new Error("BMC subscription period date is invalid");
  return `bmc_monthly_sync_${subscriptionId}_${date.toISOString().slice(0, 10)}`;
}
