import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const globalForDb = globalThis as unknown as {
  prisma: PrismaClient;
  pgPool: pg.Pool;
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

function getPool() {
  if (globalForDb.pgPool) return globalForDb.pgPool;

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL!,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on("error", (err) => {
    console.error("DB pool error (non-fatal):", err.message);
  });

  if (process.env.NODE_ENV !== "production") globalForDb.pgPool = pool;
  return pool;
}

function getPrisma() {
  if (globalForDb.prisma) return globalForDb.prisma;

  const pool = getPool();
  const adapter = new PrismaPg(pool);
  const client = new PrismaClient({ adapter }).$extends({
    query: {
      async $allOperations({ args, query }) {
        const MAX_RETRIES = 3;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            if (attempt > 0) {
              // Flush dead connections before retry
              try { const c = await pool.connect(); c.release(); } catch { /* pool reconnects */ }
            }
            return await query(args);
          } catch (err: unknown) {
            if (attempt < MAX_RETRIES && isTransientDbError(err)) {
              console.log(`DB retry ${attempt + 1}/${MAX_RETRIES} — ${(err as { code?: string }).code || "connection dropped"}`);
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

  if (process.env.NODE_ENV !== "production") globalForDb.prisma = client as unknown as PrismaClient;
  return client as unknown as PrismaClient;
}

export const prisma = getPrisma();
