// One-off pre-migration dump of the implicit M2M join table `_CredentialAssignees`,
// which `prisma db push` will DROP when `Credential.assignees` is replaced by the
// explicit `CredentialAccess` model. Run BEFORE the schema push.
//   npx tsx prisma/_dump-cred-assignees.ts
// Output: prisma/_cred-assignees-backup.json  (cuid pairs only — no secrets)
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  let rows: Array<{ A: string; B: string }> = [];
  try {
    rows = await prisma.$queryRawUnsafe<Array<{ A: string; B: string }>>(
      'SELECT "A", "B" FROM "_CredentialAssignees"'
    );
  } catch (e) {
    console.log("No _CredentialAssignees table / query failed:", (e as Error).message);
  }

  const credIds = new Set(
    (await prisma.credential.findMany({ select: { id: true } })).map((c) => c.id)
  );
  const userIds = new Set(
    (await prisma.user.findMany({ select: { id: true } })).map((u) => u.id)
  );

  // Implicit M2M columns are A/B (alphabetical by model: Credential < User => A=cred,B=user),
  // but verify empirically against the actual id sets.
  let mapping: "A=credential,B=user" | "A=user,B=credential" | "unknown" = "unknown";
  if (rows.length) {
    const r = rows[0];
    if (credIds.has(r.A) && userIds.has(r.B)) mapping = "A=credential,B=user";
    else if (userIds.has(r.A) && credIds.has(r.B)) mapping = "A=user,B=credential";
  }

  const pairs = rows.map((r) =>
    mapping === "A=user,B=credential"
      ? { credentialId: r.B, userId: r.A }
      : { credentialId: r.A, userId: r.B }
  );

  const out = {
    dumpedAt: new Date().toISOString(),
    mapping,
    rawRowCount: rows.length,
    pairs,
  };
  writeFileSync("prisma/_cred-assignees-backup.json", JSON.stringify(out, null, 2));
  console.log(`Dumped ${rows.length} assignee pair(s). mapping=${mapping}`);
  console.log(`Credentials in DB: ${credIds.size}, Users in DB: ${userIds.size}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
