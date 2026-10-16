import pg from "pg";

const globalForPool = globalThis as unknown as { pgPool?: pg.Pool };

function createPool() {
  // One shared pool per process: web + bot use at most eight sessions, leaving
  // headroom under the deployed 15-session limit for builds and maintenance.
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL!,
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on("error", (err) => {
    console.error("DB pool error (non-fatal):", err.message);
  });
  return pool;
}

// Cache in production too: Next.js can load server modules in separate bundles
// within the same process. Prisma, the polling bot, and raw bridge queries must
// all use the same connection budget.
export const databasePool = globalForPool.pgPool ??= createPool();
