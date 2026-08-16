import { NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/secret-crypto";
import { logAudit } from "@/lib/audit";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const { id } = await params;
  const transaction = await prisma.transaction.findUnique({
    where: { id },
    select: { id: true, method: true, providerDetailsEncrypted: true },
  });
  if (!transaction) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  if (!transaction.providerDetailsEncrypted) {
    return NextResponse.json({ error: "No encrypted provider details are stored for this transaction" }, { status: 404 });
  }
  let details: unknown;
  try {
    details = JSON.parse(decryptSecret(transaction.providerDetailsEncrypted));
  } catch {
    return NextResponse.json({ error: "Provider details could not be decrypted" }, { status: 500 });
  }
  await logAudit({
    userId: user.id,
    action: "PROVIDER_DETAILS_REVEAL",
    entityType: "Transaction",
    entityId: transaction.id,
    transactionId: transaction.id,
    userName: user.name,
    details: `${transaction.method} provider metadata revealed`,
  });
  return NextResponse.json({ method: transaction.method, details }, {
    headers: { "Cache-Control": "no-store" },
  });
}
