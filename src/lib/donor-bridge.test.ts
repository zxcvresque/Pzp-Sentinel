import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connect: vi.fn() }));
vi.mock("pg", () => ({ default: { Pool: class {
  on = vi.fn();
  query = mocks.query;
  connect = mocks.connect;
} } }));
import { bridgeAuthorized, refreshBridgeEvents, storeProviderDonation, type Donation } from "./donor-bridge";

const donation: Donation = { id: "bmc:123", provider: "bmc", paymentId: "123", telegramId: null,
  name: "Example", amount: "10.00", currency: "USD", occurredAt: "2026-08-13T00:00:00Z", frequency: "ONE_TIME", state: "PAID" };
beforeEach(() => {
  vi.clearAllMocks(); mocks.query.mockResolvedValue({ rows: [] });
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
});
afterEach(() => vi.unstubAllEnvs());
describe("donor bridge", () => {
  it("fails closed without a strong shared secret", () => {
    vi.stubEnv("SENTRY_BRIDGE_SECRET", "");
    expect(bridgeAuthorized(new Request("https://sentinel.test"))).toBe(false);
  });
  it("requires the exact bearer credential", () => {
    vi.stubEnv("SENTRY_BRIDGE_SECRET", "a".repeat(40));
    expect(bridgeAuthorized(new Request("https://sentinel.test", { headers: { Authorization: `Bearer ${"a".repeat(40)}` } }))).toBe(true);
    expect(bridgeAuthorized(new Request("https://sentinel.test", { headers: { Authorization: `Bearer ${"b".repeat(40)}` } }))).toBe(false);
    expect(bridgeAuthorized(new Request("https://sentinel.test", { headers: { Authorization: "a".repeat(40) } }))).toBe(false);
  });
  it("excludes payments before the IST cutoff", async () => {
    await storeProviderDonation({ ...donation, occurredAt: "2026-08-12T18:29:59Z" });
    expect(mocks.query).not.toHaveBeenCalled();
    await storeProviderDonation({ ...donation, occurredAt: "2026-08-12T18:30:00Z" });
    expect(mocks.query).toHaveBeenCalledOnce();
  });
  it("rejects unsupported money instead of treating it as INR", async () => {
    await expect(storeProviderDonation({ ...donation, currency: "EUR" })).rejects.toThrow("currency");
  });
  it("emits BMC only as its verified publication, ignoring raw provider snapshots and live ledger rows", async () => {
    const verified = { ...donation, id: "bmc:pinned", transactionId: "tx1", telegramId: "12345", verification: "BMC_COMPLETE_HISTORY" };
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT payload")) return { rows: [{ payload: donation }] }; // raw provider snapshot
      if (sql.startsWith("SELECT p.payload")) return { rows: [{ payload: verified }] };
      if (sql.includes('FROM "Transaction"')) return { rows: [{ id: "tx1", method: "BMC", bmcEventId: "bmc_support_account_123", telegramId: "12345", name: "Live", amount: "99.00", currency: "USD", date: donation.occurredAt, donationFrequency: "ONE_TIME", providerState: "CAPTURED" }] };
      return { rows: [] };
    });
    await refreshBridgeEvents();
    const writes = mocks.query.mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO donor_bridge_events"));
    expect(writes.map(([, params]) => JSON.parse(params[2]))).toEqual([verified]);
    expect(mocks.query).toHaveBeenCalledWith("COMMIT");
  });
  it("does not append a duplicate event for an unchanged snapshot", async () => {
    let digest: string | null = null;
    const razorpay = { ...donation, id: "razorpay:pay_1", provider: "razorpay", paymentId: "pay_1" };
    mocks.query.mockImplementation(async (sql: string, params: string[]) => {
      if (sql.startsWith("SELECT payload")) return { rows: [{ payload: razorpay }] };
      if (sql.startsWith("SELECT DISTINCT")) return { rows: digest ? [{ donation_id: razorpay.id, digest }] : [] };
      if (sql.startsWith("INSERT INTO donor_bridge_events")) digest=params[1];
      return { rows: [] };
    });
    await refreshBridgeEvents(); await refreshBridgeEvents();
    expect(mocks.query.mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO donor_bridge_events"))).toHaveLength(1);
  });
  it("emits nothing for an unpublished BMC ledger row, confirmed or not", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM "Transaction"')) return { rows: [{ id: "tx1", method: "BMC", bmcEventId: "bmc_monthly_sub_period_123", amount: "25", currency: "USD", date: donation.occurredAt, donationFrequency: "MONTHLY", providerState: "CAPTURED", bmcPaymentConfirmed: true }] };
      return { rows: [] };
    });
    await refreshBridgeEvents();
    expect(mocks.query.mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO donor_bridge_events"))).toHaveLength(0);
  });
  it("rolls back and releases the connection on a database error", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if(sql.startsWith("SELECT payload")) throw Error("database unavailable");
      return { rows: [] };
    });
    await expect(refreshBridgeEvents()).rejects.toThrow("database unavailable");
    expect(mocks.query).toHaveBeenCalledWith("ROLLBACK"); expect(mocks.release).toHaveBeenCalledOnce();
  });
});

it("publishes a verified BMC donation dated before the legacy cutoff (BMC history is all-time)", async () => {
  const early = { ...donation, id: "bmc:pinned", transactionId: "tx1", occurredAt: "2026-08-01T00:00:00Z", verification: "BMC_COMPLETE_HISTORY" };
  mocks.query.mockImplementation(async (sql: string) => sql.startsWith("SELECT p.payload") ? { rows: [{ payload: early }] } : { rows: [] });
  await refreshBridgeEvents();
  expect(mocks.query.mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO donor_bridge_events"))).toHaveLength(1);
});
