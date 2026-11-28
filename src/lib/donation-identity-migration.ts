import { donorPaymentIdentity } from "./donor-payment-id";

export type IdentityMigrationRow = {
  id: string; method: string; providerPaymentId: string | null;
  bmcEventId: string | null; orderPaymentId: string | null;
};

export function identityMigrationBatch(rows: IdentityMigrationRow[]) {
  return rows.map(row => ({ id: row.id,
    bridgeDonationId: donorPaymentIdentity(row.method, row.providerPaymentId || row.orderPaymentId || row.bmcEventId, row.id).id,
  }));
}

// One atomic statement avoids a network round trip per row and Prisma's
// five-second transaction limit. The null guard makes retries preserve pins.
export const PIN_DONATION_IDENTITIES_SQL = `
  UPDATE "Transaction" AS tx
  SET "bridgeDonationId" = batch."bridgeDonationId"
  FROM jsonb_to_recordset($1::jsonb) AS batch(id text, "bridgeDonationId" text)
  WHERE tx.id = batch.id AND tx."bridgeDonationId" IS NULL
`;
