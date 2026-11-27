import { bmcAccountSlug } from "./bmc-attribution";

// Shared by the live API and CSV export. Never derive identity from a name.
export function donorPaymentIdentity(method: string, reference: string | null | undefined, transactionId: string, pinnedId?: string | null) {
  const provider = method === "RAZORPAY" ? "razorpay" : method === "BMC" ? "bmc" : "manual";
  let paymentId = reference || transactionId;
  if (provider === "bmc") {
    for (const kind of ["support", "monthly", "membership", "extra", "commission", "wishlist"]) {
      const scoped = `bmc_${kind}_${bmcAccountSlug()}_`, legacy = `bmc_${kind}_`;
      if (paymentId.startsWith(scoped)) paymentId = legacy + paymentId.slice(scoped.length);
      if (kind === "support" && paymentId.startsWith(legacy)) paymentId = paymentId.slice(legacy.length);
    }
  }
  return { id: pinnedId || `${provider}:${paymentId}`, provider, paymentId };
}

// Aliases resolve to one ledger entry; they never become extra feed records.
export function donorPaymentAliases(method: string, transactionId: string, references: Array<string | null | undefined>) {
  return [...new Set(references.filter(Boolean).map(reference => donorPaymentIdentity(method, reference, transactionId).id))];
}
