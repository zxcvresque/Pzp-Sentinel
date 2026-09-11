import "dotenv/config";

// Read-only deployment check. Never creates a real payment or awards XP.
async function main() {
  const origin = process.env.SENTINEL_URL || process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.SENTRY_BRIDGE_SECRET;
  const telegramId = process.argv[2] || "604642404";
  if (!origin || !secret) throw new Error("Set SENTINEL_URL and SENTRY_BRIDGE_SECRET on the server first");
  if (!/^\d+$/.test(telegramId)) throw new Error("Telegram ID must contain only digits");
  const base = new URL(origin);
  if (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname)) {
    throw new Error("Use HTTPS for a remote Sentinel server");
  }
  async function read(path: string) {
    const response = await fetch(new URL(path, base), {
      headers: { Authorization: `Bearer ${secret}` }, cache: "no-store",
      redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Ledger check failed: HTTP ${response.status}`);
    if (!response.headers.get("cache-control")?.includes("no-store")) throw new Error("API must disable caching");
    return response.json();
  }
  let offset = 0, total = 0, matched = 0;
  for (;;) {
    const page = await read(`/api/sentry-bridge/donations?limit=500&offset=${offset}`);
    if (page.cutoff !== null) throw new Error("Server still applies the old history cutoff; upgrade it first");
    if (!Array.isArray(page.donations)) throw new Error("Invalid ledger page");
    total += page.donations.length;
    for (const donation of page.donations) {
      if (donation.telegramId !== telegramId) continue;
      matched++;
      const live = await read(`/api/sentry-bridge/donations/${encodeURIComponent(donation.transactionId)}`);
      if (live.donation?.transactionId !== donation.transactionId || live.donation?.telegramId !== telegramId) {
        throw new Error("List/detail identity changed; refresh and inspect the payment");
      }
      console.log(JSON.stringify({ telegramId, occurredAt: live.donation.occurredAt, state: live.donation.state, detailVerified: true }));
    }
    if (!page.hasMore) break;
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset) throw new Error("Invalid pagination");
    offset = page.nextOffset;
  }
  console.log(`Read ${total} historical/current payments; verified ${matched} payments for Telegram ${telegramId}. No records were written.`);
  if (!matched) {
    console.error("No eligible recorded donations for this Telegram ID; a production payment test has not been completed.");
    process.exitCode = 2;
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Ledger verification failed"); process.exitCode = 1; });
