import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { bridgePool, bridgeState, BRIDGE_START, storeProviderDonation, refreshBridgeEvents, type Donation } from "../src/lib/donor-bridge";

async function providerJson(url: string, authorization: string) {
  const response = await fetch(url, { headers: { Authorization: authorization, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
  return response.json();
}

async function razorpay() {
  const key = process.env.RAZORPAY_KEY_ID?.trim(), secret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!key?.startsWith("rzp_live_") || !secret) throw new Error("Live Razorpay key pair is required for production history");
  const authorization = `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
  const from = Math.floor(new Date(BRIDGE_START).getTime()/1000), to = Math.floor(Date.now()/1000);
  let count = 0;
  for (let skip=0;;skip+=100) {
    const data = await providerJson(`https://api.razorpay.com/v1/payments?from=${from}&to=${to}&count=100&skip=${skip}`, authorization);
    if (!Array.isArray(data.items)) throw new Error("Invalid Razorpay history response");
    for (const payment of data.items) {
      if (!["captured", "refunded"].includes(payment.status)) continue;
      // Only use server-owned order/subscription relationships for attribution.
      const known = await bridgePool.query(`SELECT u."telegramId",u.name,i."telegramId" AS guest_tg,i."guestName" AS guest_name
        FROM "RazorpayOrder" o LEFT JOIN "User" u ON u.id=o."userId"
        LEFT JOIN "OneTimeDonationInvite" i ON i.id=o."inviteId" WHERE o."razorpayOrderId"=$1`, [payment.order_id]);
      let row = known.rows[0], monthly = false;
      if (payment.invoice_id) {
        const invoice = await providerJson(`https://api.razorpay.com/v1/invoices/${encodeURIComponent(payment.invoice_id)}`, authorization);
        if (invoice.subscription_id) {
          monthly = true;
          const mapped = await bridgePool.query(`SELECT u."telegramId",u.name FROM "RazorpaySubscription" s JOIN "User" u ON u.id=s."userId" WHERE s."razorpaySubscriptionId"=$1`, [invoice.subscription_id]);
          row = mapped.rows[0] || row;
        }
      }
      await storeProviderDonation({
        id: `razorpay:${payment.id}`, provider: "razorpay", paymentId: payment.id,
        telegramId: row?.telegramId || row?.guest_tg || null, name: row?.name || row?.guest_name || "Unmatched Razorpay payer",
        amount: (Number(payment.amount)/100).toFixed(2), currency: payment.currency,
        occurredAt: new Date(payment.created_at*1000).toISOString(), frequency: monthly ? "MONTHLY" : "ONE_TIME",
        state: payment.status === "refunded" || Number(payment.amount_refunded)>0 ? "REVERSED" : "PAID",
        reversalReason: Number(payment.amount_refunded)>0 ? `Refund: ${(payment.amount_refunded/100).toFixed(2)} ${payment.currency}; review the XP reversal amount` : undefined,
      }); count++;
    }
    if (data.items.length < 100) break;
  }
  await bridgeState("razorpay", { ok: true, checked: count, at: new Date().toISOString(), since: BRIDGE_START });
}

async function bmc() {
  const token = process.env.BMC_TOKEN?.trim();
  if (!token) throw new Error("BMC_TOKEN missing; import provider export for historical coverage");
  let count=0;
  for (let page=1;page<=10000;page++) {
    // Legacy read-only API may be unavailable on some BMC accounts. A failure
    // stays visible; never claim full historical coverage from webhooks alone.
    const data = await providerJson(`https://developers.buymeacoffee.com/api/v1/supporters?page=${page}`, `Bearer ${token}`);
    if (!Array.isArray(data.data)) throw new Error("BMC history unavailable; use a verified export");
    for (const support of data.data) {
      if (!support.support_id || !support.support_created_on || support.support_coffee_price == null || support.support_coffees == null || !support.support_currency) {
        throw new Error("BMC history format is incomplete; manual export reconciliation required");
      }
      const when = new Date(support.support_created_on);
      if (!Number.isFinite(when.getTime())) throw new Error("Invalid BMC payment timestamp");
      const id = String(support.support_id);
      await storeProviderDonation({ id: `bmc:${id}`, provider: "bmc", paymentId: id,
        telegramId: null, name: String(support.supporter_name || "Unmatched BMC payer"),
        amount: (Number(support.support_coffee_price)*Number(support.support_coffees)).toFixed(2),
        currency: String(support.support_currency).toUpperCase(), occurredAt: when.toISOString(),
        frequency: "ONE_TIME", state: "PAID" }); count++;
    }
    if (!data.next_page_url) break;
    if (page === 10000) throw new Error("BMC history pagination exceeded safety limit");
  }
  await bridgeState("bmc", { ok: true, checked: count, at: new Date().toISOString(),
    coverage: "One-time supports plus Sentinel ledger/webhooks. Membership charge history requires reconciliation against provider export." });
}

async function sweep() {
  for (const [name, run] of [["razorpay", razorpay], ["bmc", bmc]] as const) {
    try { await run(); }
    catch(e) { await bridgeState(name, { ok: false, at: new Date().toISOString(), error: e instanceof Error ? e.message : "Sync failed" }); }
  }
  await refreshBridgeEvents();
}

async function main() {
  if (process.argv.includes("--setup")) {
    await bridgePool.query(await readFile(resolve(process.cwd(), "scripts/donor-bridge-schema.sql"), "utf8"));
    console.log("Additive donor bridge schema installed."); return;
  }
  const importAt = process.argv.indexOf("--import");
  if (importAt >= 0) {
    // Reviewed normalized payment export. Do not import subscription totals as charges.
    const rows: Donation[] = JSON.parse(await readFile(process.argv[importAt+1], "utf8"));
    for (const d of rows) {
      if (!["razorpay","bmc"].includes(d.provider) || d.id !== `${d.provider}:${d.paymentId}` || !["PAID","REVERSED"].includes(d.state) || !["ONE_TIME","MONTHLY"].includes(d.frequency) || !Number.isFinite(new Date(d.occurredAt).getTime())) throw new Error("Invalid normalized export");
      await storeProviderDonation(d);
    }
    await bridgeState("export", { at: new Date().toISOString(), count: rows.length });
    await refreshBridgeEvents(); return;
  }
  do {
    try { await sweep(); } catch { console.error("Bridge sweep failed; retrying next cycle. Check database/schema."); }
    if (!process.argv.includes("--watch")) break;
    await new Promise(resolve => setTimeout(resolve, 300000));
  } while(true);
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Bridge failed"); process.exitCode=1; }).finally(() => bridgePool.end());
