import { bmcAccountSlug } from "./bmc-attribution";

// Shared by the live API and CSV export. Never derive identity from a name.
export function donorPaymentIdentity(method: string, reference: string | null | undefined, transactionId: string) {
  const provider = method === "RAZORPAY" ? "razorpay" : method === "BMC" ? "bmc" : "manual";
  let paymentId = reference || transactionId;
  if (provider === "bmc") {
    for (const kind of ["support", "monthly", "membership", "extra", "commission", "wishlist"]) {
      const scoped = `bmc_${kind}_${bmcAccountSlug()}_`, legacy = `bmc_${kind}_`;
      if (paymentId.startsWith(scoped)) paymentId = legacy + paymentId.slice(scoped.length);
      if (kind === "support" && paymentId.startsWith(legacy)) paymentId = paymentId.slice(legacy.length);
    }
  }
  return { id: `${provider}:${paymentId}`, provider, paymentId };
}
