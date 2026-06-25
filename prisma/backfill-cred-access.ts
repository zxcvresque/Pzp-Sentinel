// One-off backfill after the CredentialAccess migration.
//   npx tsx prisma/backfill-cred-access.ts
// 1. Recreate prior `_CredentialAssignees` pairs (dumped to _cred-assignees-backup.json)
//    as CredentialAccess rows with FULL access, already granted.
// 2. Mirror every existing VpsServer's secrets into linked Credential rows.
// Self-contained (own client + inlined VPS specs) so it doesn't depend on the
// app's `@/` path alias or network-backed github logging.
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const VPS_CRED_SPECS = [
  { credKind: "VPS_PASSWORD", label: "Root Password", get: (s: { password: string }) => (s.password ?? "").trim() },
  { credKind: "VPS_SSH_KEY", label: "SSH Private Key", get: (s: { sshKeyFileUrl: string | null }) => (s.sshKeyFileUrl ?? "").trim() },
];

async function main() {
  const now = new Date();

  // --- 1. Recreate assignee pairs as FULL/granted access rows ---
  const backupPath = "prisma/_cred-assignees-backup.json";
  let pairs: Array<{ credentialId: string; userId: string }> = [];
  if (existsSync(backupPath)) {
    pairs = JSON.parse(readFileSync(backupPath, "utf8")).pairs ?? [];
  }
  let accessCreated = 0;
  for (const p of pairs) {
    // Skip if either side no longer exists.
    const [cred, user] = await Promise.all([
      prisma.credential.findUnique({ where: { id: p.credentialId }, select: { id: true } }),
      prisma.user.findUnique({ where: { id: p.userId }, select: { id: true } }),
    ]);
    if (!cred || !user) continue;
    await prisma.credentialAccess.upsert({
      where: { credentialId_userId: { credentialId: p.credentialId, userId: p.userId } },
      create: { credentialId: p.credentialId, userId: p.userId, accessLevel: "FULL", granted: true, grantedAt: now },
      update: { accessLevel: "FULL", granted: true, grantedAt: now },
    });
    accessCreated++;
  }
  console.log(`Backfilled ${accessCreated} CredentialAccess row(s) from ${pairs.length} dumped pair(s).`);

  // --- 2. Mirror existing VPS secrets into linked credentials ---
  const fallbackAdmin =
    (await prisma.user.findFirst({ where: { roles: { has: "ADMIN" } }, select: { id: true } })) ??
    (await prisma.user.findFirst({ select: { id: true } }));
  if (!fallbackAdmin) {
    console.log("No users in DB — skipping VPS credential backfill.");
    return;
  }

  const servers = await prisma.vpsServer.findMany();
  let credCreated = 0;
  for (const server of servers) {
    const createdById = server.addedById ?? fallbackAdmin.id;
    for (const spec of VPS_CRED_SPECS) {
      const value = spec.get(server);
      if (!value) continue;
      const existing = await prisma.credential.findFirst({
        where: { vpsServerId: server.id, credKind: spec.credKind },
      });
      if (existing) {
        await prisma.credential.update({
          where: { id: existing.id },
          data: { value, platform: server.name, label: spec.label },
        });
      } else {
        await prisma.credential.create({
          data: {
            platform: server.name,
            label: spec.label,
            value,
            createdById,
            vpsServerId: server.id,
            credKind: spec.credKind,
          },
        });
        credCreated++;
      }
    }
  }
  console.log(`Mirrored secrets for ${servers.length} VPS server(s); created ${credCreated} linked credential(s).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
