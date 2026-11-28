import "dotenv/config";

// Read-only deployment check. Never creates a real payment or awards XP.
async function main() {
  const origin = process.env.SENTINEL_URL || process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.SENTRY_BRIDGE_SECRET;
  const telegramId = process.argv[2] || "604642404";
  if (!origin || !secret) throw new Error("Set SENTINEL_URL and SENTRY_BRIDGE_SECRET on the server first");
  if (!/^[1-9]\d{0,18}$/.test(telegramId)) throw new Error("Telegram ID must contain only digits");
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
  const transactions = new Set<string>();
  const identities = new Set<string>();
  const eligible = new Set<string>();
  let autoXp: { payments?: Array<{ id: string }>; activeUntil?: string | null } | undefined;
  for (;;) {
    const page = await read(`/api/sentry-bridge/donations?telegramId=${telegramId}&limit=500&offset=${offset}`);
    if (page.cutoff !== null) throw new Error("Server still applies the old history cutoff; upgrade it first");
    if (!Array.isArray(page.donations)) throw new Error("Invalid ledger page");
    if (page.donor?.donorKey !== `telegram:${telegramId}` || !Number.isSafeInteger(page.donor.donationCount)) throw new Error("Telegram donor summary is missing; deploy the identity update first");
    if (offset === 0) { console.log(JSON.stringify({ donor: page.donor })); autoXp = page.donor.autoXp; }
    if (!autoXp || !Array.isArray(autoXp.payments)) throw new Error("donor.autoXp is missing; deploy the auto-XP update first");
    total += page.donations.length;
    for (const donation of page.donations) {
      if (donation.telegramId !== telegramId || donation.donorKey !== `telegram:${telegramId}`) throw new Error("API returned a different Telegram donor");
      if (!donation.transactionId || donation.idempotencyKey !== `sentinel:transaction:${donation.transactionId}`) throw new Error("Stable transaction key is missing");
      if (transactions.has(donation.transactionId) || identities.has(donation.id)) throw new Error("A donation appeared more than once");
      transactions.add(donation.transactionId); identities.add(donation.id);
      matched++;
      if (donation.state === "PAID" && donation.xpEligible) eligible.add(donation.id);
      console.log(JSON.stringify({ telegramId, transactionId: donation.transactionId, id: donation.id, idempotencyKey: donation.idempotencyKey, occurredAt: donation.occurredAt, state: donation.state, xpEligible: donation.xpEligible }));
    }
    if (!page.hasMore) break;
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset) throw new Error("Invalid pagination");
    offset = page.nextOffset;
  }
  // auto-XP must count exactly the listed PAID, XP-eligible payments.
  const counted = new Set((autoXp?.payments || []).map(payment => payment.id));
  if (counted.size !== eligible.size || [...eligible].some(id => !counted.has(id))) throw new Error("donor.autoXp does not count exactly the listed XP-eligible payments");
  console.log(JSON.stringify({ autoXpActiveUntil: autoXp?.activeUntil ?? null, autoXpPayments: counted.size }));
  console.log(`Read ${total} historical/current payments; verified ${matched} payments for Telegram ${telegramId}. No records were written.`);
  if (!matched) {
    console.error("No eligible recorded donations for this Telegram ID; a production payment test has not been completed.");
    process.exitCode = 2;
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Ledger verification failed"); process.exitCode = 1; });
