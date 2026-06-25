// One-time migration: encrypt secrets that are still plaintext at rest.
//   npx tsx prisma/encrypt-existing-secrets.ts
// Idempotent — rows already in `enc:v1:` form are skipped. Safe to re-run.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { encryptSecret, isEncrypted } from "../src/lib/secret-crypto";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // --- Credential.value ---
  const creds = await prisma.credential.findMany({ select: { id: true, value: true } });
  let credEnc = 0;
  for (const c of creds) {
    if (c.value && !isEncrypted(c.value)) {
      await prisma.credential.update({ where: { id: c.id }, data: { value: encryptSecret(c.value) } });
      credEnc++;
    }
  }
  console.log(`Encrypted ${credEnc}/${creds.length} credential value(s).`);

  // --- VpsServer.password + sshKeyFileUrl ---
  const servers = await prisma.vpsServer.findMany({
    select: { id: true, password: true, sshKeyFileUrl: true },
  });
  let srvEnc = 0;
  for (const s of servers) {
    const data: { password?: string; sshKeyFileUrl?: string } = {};
    if (s.password && !isEncrypted(s.password)) data.password = encryptSecret(s.password);
    if (s.sshKeyFileUrl && !isEncrypted(s.sshKeyFileUrl)) data.sshKeyFileUrl = encryptSecret(s.sshKeyFileUrl);
    if (Object.keys(data).length) {
      await prisma.vpsServer.update({ where: { id: s.id }, data });
      srvEnc++;
    }
  }
  console.log(`Encrypted secrets on ${srvEnc}/${servers.length} VPS server(s).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
