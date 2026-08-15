import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logCredentialAction } from "@/lib/github-log";
import { notify, formatTgMessage } from "@/lib/notifications";
import { encryptSecret, decryptSecret } from "@/lib/secret-crypto";

const userSelect = { id: true, name: true, photoUrl: true, telegramUser: true };
const ACCESS_LEVELS = ["PUBLIC_KEY", "FULL"] as const;
type AccessLevel = (typeof ACCESS_LEVELS)[number];

// credKind -> the VpsServer column it mirrors (for write-back).
const CRED_KIND_COLUMN: Record<string, "password" | "sshKeyFileUrl"> = {
  VPS_PASSWORD: "password",
  VPS_SSH_KEY: "sshKeyFileUrl",
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isAdmin = hasRole(user.roles, "ADMIN");
  if (!isAdmin) {
    return NextResponse.json({ error: "Only admins can update credentials" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { platform, label, value, accesses, serviceId, expiresAt } = body;

  const existing = await prisma.credential.findUnique({
    where: { id },
    include: { accesses: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Validate the share list up-front (force-choice on accessLevel).
  let incoming: { userId: string; accessLevel: AccessLevel; granted?: boolean }[] | undefined;
  if (accesses !== undefined) {
    incoming = Array.isArray(accesses) ? accesses : [];
    for (const a of incoming) {
      if (!a?.userId || !ACCESS_LEVELS.includes(a.accessLevel)) {
        return NextResponse.json(
          { error: "Each access entry needs a userId and accessLevel (PUBLIC_KEY or FULL)" },
          { status: 400 },
        );
      }
    }
  }

  const valueChanged = typeof value === "string" && value.length > 0;
  if (serviceId && !await prisma.service.findUnique({ where: { id: serviceId }, select: { id: true } })) {
    return NextResponse.json({ error: "Linked service not found" }, { status: 400 });
  }
  const parsedExpiry = expiresAt ? new Date(expiresAt) : null;
  if (parsedExpiry && Number.isNaN(parsedExpiry.getTime())) {
    return NextResponse.json({ error: "Invalid credential expiry" }, { status: 400 });
  }

  // 1. Scalar fields (value encrypted at rest).
  const credential = await prisma.credential.update({
    where: { id },
    data: {
      ...(platform && { platform }),
      ...(label && { label }),
      ...(valueChanged && { value: encryptSecret(value) }),
      ...(serviceId !== undefined && { serviceId: serviceId || null }),
      ...(expiresAt !== undefined && { expiresAt: parsedExpiry }),
    },
    include: { createdBy: { select: userSelect } },
  });
  if (expiresAt !== undefined) {
    await prisma.operationalAlert.updateMany({
      where: { credentialId: id, status: "OPEN", kind: "CREDENTIAL_EXPIRY" },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
  }

  // 1b. Write the new value back to the VpsServer column so the admin SSH /
  //     sshpass / authorized_keys builders stay correct.
  if (valueChanged && existing.vpsServerId && existing.credKind) {
    const col = CRED_KIND_COLUMN[existing.credKind];
    if (col) {
      await prisma.vpsServer.update({
        where: { id: existing.vpsServerId },
        data: { [col]: encryptSecret(value) },
      });
    }
  }

  // 2. Reconcile per-dev access rows.
  const newlyGranted: { userId: string; accessLevel: string }[] = [];
  if (incoming) {
    const incomingByUser = new Map(incoming.map((a) => [a.userId, a]));
    const existingByUser = new Map(existing.accesses.map((a) => [a.userId, a]));
    const now = new Date();

    const removed = existing.accesses.filter((a) => !incomingByUser.has(a.userId));
    if (removed.length) {
      await prisma.credentialAccess.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });
      logCredentialAction({
        action: "REVOKE",
        userId: user.id,
        userName: user.name,
        entityId: id,
        platform: credential.platform,
        details: removed.map((r) => r.userId.slice(0, 8)).join(", "),
      });
    }

    for (const a of incoming) {
      const prev = existingByUser.get(a.userId);
      const wasGranted = prev?.granted ?? false;
      // Default grant state: keep prior for existing rows; new FULL is live, new PUBLIC_KEY waits.
      const granted = a.granted ?? (prev ? prev.granted : a.accessLevel === "FULL");
      await prisma.credentialAccess.upsert({
        where: { credentialId_userId: { credentialId: id, userId: a.userId } },
        create: {
          credentialId: id,
          userId: a.userId,
          accessLevel: a.accessLevel,
          granted,
          grantedAt: granted ? now : null,
        },
        update: {
          accessLevel: a.accessLevel,
          granted,
          grantedAt: granted ? (prev?.grantedAt ?? now) : null,
        },
      });
      if (granted && !wasGranted) {
        newlyGranted.push({ userId: a.userId, accessLevel: a.accessLevel });
        logCredentialAction({
          action: "GRANT",
          userId: user.id,
          userName: user.name,
          entityId: id,
          platform: credential.platform,
          details: `${a.userId.slice(0, 8)}:${a.accessLevel}`,
        });
      }
    }
  }

  logCredentialAction({
    action: "UPDATED",
    userId: user.id,
    userName: user.name,
    entityId: id,
    platform: credential.platform,
    details: `Updated: ${credential.label}`,
  });

  for (const t of newlyGranted) {
    notify({
      userId: t.userId,
      type: "CREDENTIAL_ASSIGNED",
      title: "Credential Access Granted",
      message: `${credential.platform} -- ${credential.label}: access granted by ${user.name} (${t.accessLevel === "FULL" ? "full access" : "public-key access"}).`,
      entityId: id,
      priority: "NORMAL",
      actionUrl: "/credentials",
      telegramMessage: formatTgMessage(
        "🔓 Credential Access Granted",
        `${credential.platform} · ${credential.label}`,
        `Granted by ${user.name} · ${t.accessLevel === "FULL" ? "Full access" : "Public-key access"}`,
      ),
    }).catch((err) => console.error("[cred] notify failed:", err));
  }

  // Response with fresh access list (admin sees plaintext value).
  const full = await prisma.credential.findUnique({
    where: { id },
    include: {
      accesses: { include: { user: { select: userSelect } } },
      createdBy: { select: userSelect },
      vpsServer: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json({
    credential: full ? { ...full, value: decryptSecret(full.value) } : credential,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isAdmin = hasRole(user.roles, "ADMIN");
  if (!isAdmin) {
    return NextResponse.json({ error: "Only admins can delete credentials" }, { status: 403 });
  }

  const { id } = await params;

  const existing = await prisma.credential.findUnique({ where: { id } });
  // Revisions (parentId) and CredentialAccess rows cascade on delete.
  await prisma.credential.deleteMany({ where: { parentId: id } });
  await prisma.credential.delete({ where: { id } });

  logCredentialAction({
    action: "DELETED",
    userId: user.id,
    userName: user.name,
    entityId: id,
    platform: existing?.platform || "unknown",
    details: `Deleted: ${existing?.label || id}`,
  });

  return NextResponse.json({ success: true });
}
