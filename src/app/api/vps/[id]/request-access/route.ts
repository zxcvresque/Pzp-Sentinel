import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { logCredentialAction } from "@/lib/github-log";
import { notifyAdmins, formatTgMessage } from "@/lib/notifications";

// Lenient SSH public-key shape check (openssh authorized_keys line).
function looksLikePublicKey(s: string): boolean {
  return /^(ssh-(rsa|ed25519|dss)|ecdsa-sha2-[\w-]+|sk-[\w@.-]+)\s+\S+/.test(s.trim());
}

/**
 * Dev self-service: request SSH access to a VPS by submitting their own public
 * key. This never exposes the server's password/private key — it records a
 * PUBLIC_KEY access (granted:false) on the server's primary linked credential
 * and pings admins to install the key and grant access.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user.roles, "DEV") && !hasRole(user.roles, "ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { devPublicKey } = await req.json();
  const key = String(devPublicKey ?? "").trim();
  if (!looksLikePublicKey(key)) {
    return NextResponse.json({ error: "A valid SSH public key is required" }, { status: 400 });
  }

  const server = await prisma.vpsServer.findUnique({
    where: { id },
    select: { id: true, name: true, approved: true },
  });
  if (!server || !server.approved) {
    return NextResponse.json({ error: "Server not found" }, { status: 404 });
  }

  // Attach to the server's primary linked credential (SSH key > password > first).
  const linked = await prisma.credential.findMany({
    where: { vpsServerId: id, parentId: null },
    select: { id: true, credKind: true },
  });
  if (!linked.length) {
    return NextResponse.json(
      { error: "This server has no shareable credentials yet" },
      { status: 400 },
    );
  }
  const primary =
    linked.find((c) => c.credKind === "VPS_SSH_KEY") ??
    linked.find((c) => c.credKind === "VPS_PASSWORD") ??
    linked[0];

  // Changing the key requires a fresh grant (the new key isn't installed yet).
  const existing = await prisma.credentialAccess.findUnique({
    where: { credentialId_userId: { credentialId: primary.id, userId: user.id } },
  });
  const keyChanged = !existing || existing.devPublicKey !== key;

  await prisma.credentialAccess.upsert({
    where: { credentialId_userId: { credentialId: primary.id, userId: user.id } },
    create: {
      credentialId: primary.id,
      userId: user.id,
      accessLevel: "PUBLIC_KEY",
      devPublicKey: key,
      granted: false,
    },
    update: {
      accessLevel: "PUBLIC_KEY",
      devPublicKey: key,
      ...(keyChanged ? { granted: false, grantedAt: null } : {}),
    },
  });

  logCredentialAction({
    action: "REQUEST",
    userId: user.id,
    userName: user.name,
    entityId: primary.id,
    platform: server.name,
    details: `${user.name} requested SSH access`,
  });

  notifyAdmins({
    type: "CREDENTIAL_ASSIGNED",
    title: "VPS Access Requested",
    message: `${user.name} requested SSH access to ${server.name} and submitted a public key. Install it on the box and grant access.`,
    entityId: primary.id,
    priority: "HIGH",
    actionUrl: "/admin/credentials",
    telegramMessage: formatTgMessage(
      "🙋 VPS Access Requested",
      `${server.name}`,
      `By ${user.name} — install key & grant`,
    ),
  }).catch((err) => console.error("[vps] notifyAdmins failed:", err));

  return NextResponse.json({ ok: true, status: "requested" });
}
