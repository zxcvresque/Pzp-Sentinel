import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logCredentialAction } from "@/lib/github-log";
import { notify, formatTgMessage } from "@/lib/notifications";
import { encryptSecret } from "@/lib/secret-crypto";
import { logAudit } from "@/lib/audit";

const userSelect = { id: true, name: true, photoUrl: true, telegramUser: true };
const ACCESS_LEVELS = ["PUBLIC_KEY", "FULL"] as const;
type AccessLevel = (typeof ACCESS_LEVELS)[number];

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const isAdmin = hasRole(user.roles, "ADMIN");

    if (isAdmin) {
      const credentials = await prisma.credential.findMany({
        where: { parentId: null },
        include: {
          accesses: { include: { user: { select: userSelect } } },
          createdBy: { select: userSelect },
          vpsServer: { select: { id: true, name: true } },
          service: { select: { id: true, name: true } },
          revisions: {
            where: { status: "PENDING" },
            include: { createdBy: { select: userSelect } },
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: [{ platform: "asc" }, { label: "asc" }],
      });
      const safe = credentials.map((credential) => ({
        ...credential,
        value: undefined,
        hasValue: true,
        revisions: credential.revisions.map((revision) => ({ ...revision, value: undefined, hasValue: true })),
      }));
      return NextResponse.json({ credentials: safe });
    }

    if (hasRole(user.roles, "DEV")) {
      // Credentials the dev has been GRANTED. NOTE: the secret `value` is never
      // included here — it is only retrievable via the audited reveal endpoint.
      const grantedRows = await prisma.credential.findMany({
        where: {
          accesses: { some: { userId: user.id, granted: true } },
          parentId: null,
          status: "APPROVED",
        },
        include: {
          accesses: { where: { userId: user.id } },
          createdBy: { select: userSelect },
          vpsServer: { select: { id: true, name: true } },
        },
        orderBy: [{ platform: "asc" }, { label: "asc" }],
      });
      const credentials = grantedRows.map((c) => {
        const a = c.accesses[0];
        return {
          id: c.id,
          platform: c.platform,
          label: c.label,
          status: c.status,
          createdBy: c.createdBy,
          vpsServer: c.vpsServer,
          credKind: c.credKind,
          accessLevel: a?.accessLevel ?? null,
          granted: a?.granted ?? false,
          devPublicKey: a?.devPublicKey ?? null,
        };
      });

      // Shares awaiting an admin grant (e.g. PUBLIC_KEY requested, key not yet installed).
      const pendingRows = await prisma.credential.findMany({
        where: {
          accesses: { some: { userId: user.id, granted: false } },
          parentId: null,
          status: "APPROVED",
        },
        include: {
          accesses: { where: { userId: user.id } },
          vpsServer: { select: { id: true, name: true } },
        },
        orderBy: [{ platform: "asc" }, { label: "asc" }],
      });
      const pendingGrants = pendingRows.map((c) => {
        const a = c.accesses[0];
        return {
          id: c.id,
          platform: c.platform,
          label: c.label,
          vpsServer: c.vpsServer,
          credKind: c.credKind,
          accessLevel: a?.accessLevel ?? null,
          granted: false,
          devPublicKey: a?.devPublicKey ?? null,
        };
      });

      // Pending proposals remain encrypted in list responses. A full-access
      // reveal uses the same audited endpoint as every other secret access.
      const pendingByMe = await prisma.credential.findMany({
        where: { createdById: user.id, status: "PENDING" },
        include: { parent: { select: { id: true, platform: true, label: true } } },
        orderBy: { createdAt: "desc" },
      });
      const pending = pendingByMe.map((credential) => ({ ...credential, value: undefined, hasValue: true }));

      return NextResponse.json({ credentials, pendingGrants, pending });
    }

    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } catch {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isAdmin = hasRole(user.roles, "ADMIN");
  const isDev = hasRole(user.roles, "DEV");
  if (!isAdmin && !isDev) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { platform, label, value, accesses, parentId, serviceId, expiresAt } = body;

  if (!platform || !label || !value) {
    return NextResponse.json(
      { error: "Platform, label, and value are required" },
      { status: 400 },
    );
  }

  if (isAdmin) {
    if (serviceId && !await prisma.service.findUnique({ where: { id: serviceId }, select: { id: true } })) {
      return NextResponse.json({ error: "Linked service not found" }, { status: 400 });
    }
    const parsedExpiry = expiresAt ? new Date(expiresAt) : null;
    if (parsedExpiry && Number.isNaN(parsedExpiry.getTime())) {
      return NextResponse.json({ error: "Invalid credential expiry" }, { status: 400 });
    }
    // Validate the share list — force-choice: every share must name an explicit level.
    const accessRows: { userId: string; accessLevel: AccessLevel }[] = Array.isArray(accesses)
      ? accesses
      : [];
    for (const a of accessRows) {
      if (!a?.userId || !ACCESS_LEVELS.includes(a.accessLevel)) {
        return NextResponse.json(
          { error: "Each access entry needs a userId and accessLevel (PUBLIC_KEY or FULL)" },
          { status: 400 },
        );
      }
    }
    if (accessRows.length) {
      const validTargets = await prisma.user.count({
        where: {
          id: { in: [...new Set(accessRows.map((row) => row.userId))] },
          status: "ACTIVE",
          roles: { has: "DEV" },
        },
      });
      if (validTargets !== new Set(accessRows.map((row) => row.userId)).size) {
        return NextResponse.json({ error: "Every credential recipient must be an active developer" }, { status: 400 });
      }
    }
    const now = new Date();
    const credential = await prisma.credential.create({
      data: {
        platform,
        label,
        value: encryptSecret(value),
        status: "APPROVED",
        createdById: user.id,
        serviceId: serviceId || null,
        expiresAt: parsedExpiry,
        accesses: accessRows.length
          ? {
              create: accessRows.map((a) => ({
                userId: a.userId,
                accessLevel: a.accessLevel,
                // FULL shared directly by admin is live immediately; PUBLIC_KEY
                // waits until the admin installs the dev's key and grants it.
                granted: a.accessLevel === "FULL",
                grantedAt: a.accessLevel === "FULL" ? now : null,
              })),
            }
          : undefined,
      },
      include: {
        accesses: { include: { user: { select: userSelect } } },
        createdBy: { select: userSelect },
      },
    });

    logCredentialAction({
      action: "CREATED",
      userId: user.id,
      userName: user.name,
      entityId: credential.id,
      platform,
      details: `Admin created: ${label}`,
    });
    if (accessRows.length) {
      logCredentialAction({
        action: "SHARE",
        userId: user.id,
        userName: user.name,
        entityId: credential.id,
        platform,
        details: accessRows.map((a) => `${a.userId.slice(0, 8)}:${a.accessLevel}`).join(", "),
      });
    }

    for (const a of accessRows) {
      notify({
        userId: a.userId,
        type: "CREDENTIAL_ASSIGNED",
        title: "Credential Shared",
        message: `${platform} -- ${label} has been shared with you by ${user.name} (${a.accessLevel === "FULL" ? "full access" : "public-key access"}).`,
        entityId: credential.id,
        priority: "NORMAL",
        actionUrl: "/dev/credentials",
        telegramMessage: formatTgMessage(
          "🔐 Credential Shared",
          `${platform} · ${label}`,
          `Shared by ${user.name} · ${a.accessLevel === "FULL" ? "Full access" : "Public-key access"}`,
        ),
      }).catch((err) => console.error("[cred] notify failed:", err));
    }

    await logAudit({
      userId: user.id,
      action: "CREDENTIAL_CREATE",
      entityType: "Credential",
      entityId: credential.id,
      after: {
        platform: credential.platform,
        label: credential.label,
        serviceId: credential.serviceId,
        expiresAt: credential.expiresAt,
        shares: accessRows,
      },
      userName: user.name,
      request: req,
    });

    return NextResponse.json(
      { credential: { ...credential, value: undefined, hasValue: true } },
      { status: 201 },
    );
  }

  // Dev proposal — stored PENDING for admin review. Value encrypted at rest.
  const credential = await prisma.credential.create({
    data: {
      platform,
      label,
      value: encryptSecret(value),
      status: "PENDING",
      createdById: user.id,
      parentId: parentId || null,
    },
  });
  logCredentialAction({
    action: "PROPOSED",
    userId: user.id,
    userName: user.name,
    entityId: credential.id,
    platform,
    details: `Dev proposed: ${label}${parentId ? ` (revision of ${parentId.slice(0, 8)})` : ""}`,
  });

  await logAudit({
    userId: user.id,
    action: "CREDENTIAL_PROPOSE",
    entityType: "Credential",
    entityId: credential.id,
    after: { platform, label, parentId: parentId || null },
    userName: user.name,
    request: req,
  });

  return NextResponse.json({ credential: { ...credential, value: undefined, hasValue: true }, message: "Submitted for admin approval" }, { status: 201 });
}
