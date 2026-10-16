import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { databasePool as pool } from "./database-pool";

const globalForDb = globalThis as unknown as {
  prisma?: PrismaClient;
};

function isTransientDbError(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  const msg = String(err);
  return !!(
    code === "P1017" || code === "P1001" || code === "ECONNRESET" ||
    code === "ECONNREFUSED" || code === "ETIMEDOUT" ||
    msg.includes("Connection terminated") ||
    msg.includes("closed the connection") ||
    msg.includes("ECONNRESET")
  );
}

function getPrisma() {
  if (globalForDb.prisma) return globalForDb.prisma;

  const adapter = new PrismaPg(pool);
  const client = new PrismaClient({ adapter }).$extends({
    query: {
      async $allOperations({ args, query }) {
        const MAX_RETRIES = 3;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            return await query(args);
          } catch (err: unknown) {
            if (attempt < MAX_RETRIES && isTransientDbError(err)) {
              console.warn(`DB retry ${attempt + 1}/${MAX_RETRIES} — ${(err as { code?: string }).code || "connection dropped"}`);
              await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
              continue;
            }
            throw err;
          }
        }
        throw new Error("DB retry exhausted");
      },
    },
  });

  globalForDb.prisma = client as unknown as PrismaClient;
  return client as unknown as PrismaClient;
}

export const prisma = getPrisma();
