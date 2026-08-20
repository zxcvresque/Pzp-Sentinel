import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logCredentialAction } from "@/lib/github-log";
import { decryptSecret } from "@/lib/secret-crypto";
import { logAudit } from "@/lib/audit";

/**
 * The ONLY endpoint that returns a decrypted secret value. Authorization is
 * decided here and nowhere else: an admin, or a dev whose own access row is
 * FULL and granted. PUBLIC_KEY or un-granted access → 403. Every reveal is
 * logged to the immutable audit trail + Telegram audit topic.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const isAdmin = hasRole(user.roles, "ADMIN");
  const body = await req.json().catch(() => ({}));
  const purpose = body?.purpose === "COPY" ? "COPY" : "REVEAL";

  const credential = await prisma.credential.findUnique({
    where: { id },
    include: { accesses: { where: { userId: user.id } } },
  });
  if (!credential) {
    await logAudit({ userId: user.id, userName: user.name, action: "CREDENTIAL_ACCESS_DENIED", entityType: "Credential", entityId: id, request: req, outcome: "FAILURE", errorMessage: "Credential not found" });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let allowed = isAdmin;
  if (!allowed) {
    const a = credential.accesses[0];
    allowed = !!a && a.accessLevel === "FULL" && a.granted === true;
  }
  if (!allowed) {
    await logAudit({ userId: user.id, userName: user.name, action: "CREDENTIAL_ACCESS_DENIED", entityType: "Credential", entityId: id, after: { purpose }, request: req, outcome: "FAILURE", errorMessage: "Full access required" });
    return NextResponse.json(
      { error: "You do not have full access to this credential" },
      { status: 403 },
    );
  }

  logCredentialAction({
    action: isAdmin ? "ADMIN_REVEAL" : "DEV_REVEAL",
    userId: user.id,
    userName: user.name,
    entityId: id,
    platform: credential.platform,
    details: `${purpose}: ${credential.label}`,
  });
  await logAudit({
    userId: user.id,
    action: `CREDENTIAL_${purpose}`,
    entityType: "Credential",
    entityId: id,
    after: { platform: credential.platform, label: credential.label, access: isAdmin ? "ADMIN" : "FULL" },
    userName: user.name,
    request: req,
  });

  return NextResponse.json({ value: decryptSecret(credential.value) }, { headers: { "Cache-Control": "private, no-store" } });
}
