type ProviderVerificationRecord = {
  method: string;
  providerVerified: boolean;
  providerDetailsEncrypted?: string | null;
};

/**
 * Provider metadata is only persisted after Razorpay API verification or a
 * verified BMC webhook. Older rows predate the providerVerified column, so
 * their encrypted evidence remains authoritative after a credential rotation.
 */
export function isProviderVerified(record: ProviderVerificationRecord) {
  return record.providerVerified || (
    (record.method === "RAZORPAY" || record.method === "BMC")
    && Boolean(record.providerDetailsEncrypted)
  );
}
