import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pools: [] as { options: { max: number; idleTimeoutMillis: number }; on: ReturnType<typeof vi.fn> }[],
  adapters: [] as unknown[],
  clients: [] as unknown[],
}));

vi.mock("pg", () => ({ default: { Pool: class {
  on = vi.fn();
  constructor(public options: { max: number; idleTimeoutMillis: number }) {
    mocks.pools.push(this);
  }
} } }));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: class {
  constructor(pool: unknown) { mocks.adapters.push(pool); }
} }));
vi.mock("@/generated/prisma/client", () => ({ PrismaClient: class {
  constructor() { mocks.clients.push(this); }
  $extends() { return this; }
} }));

const globals = globalThis as unknown as { pgPool?: unknown; prisma?: unknown };
let previous: { pgPool?: unknown; prisma?: unknown };

beforeEach(() => {
  previous = { pgPool: globals.pgPool, prisma: globals.prisma };
  delete globals.pgPool;
  delete globals.prisma;
  mocks.pools.length = 0;
  mocks.adapters.length = 0;
  mocks.clients.length = 0;
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "production");
});
afterEach(() => {
  if (previous.pgPool === undefined) delete globals.pgPool;
  else globals.pgPool = previous.pgPool;
  if (previous.prisma === undefined) delete globals.prisma;
  else globals.prisma = previous.prisma;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("runtime PostgreSQL connection budget", () => {
  it("shares one four-connection pool between Prisma and raw bridge queries", async () => {
    const { databasePool } = await import("./database-pool");
    const { bridgePool } = await import("./donor-bridge");
    await import("./db");
    expect(bridgePool).toBe(databasePool);
    expect(mocks.adapters).toEqual([databasePool]);
    expect(mocks.pools).toHaveLength(1);
    expect(mocks.pools[0].options).toMatchObject({ max: 4, idleTimeoutMillis: 10_000 });
  });

  it("retains the pool and Prisma client when production modules are reloaded", async () => {
    const firstPool = (await import("./database-pool")).databasePool;
    const firstClient = (await import("./db")).prisma;
    vi.resetModules();
    expect((await import("./database-pool")).databasePool).toBe(firstPool);
    expect((await import("./db")).prisma).toBe(firstClient);
    expect((await import("./donor-bridge")).bridgePool).toBe(firstPool);
    expect(mocks.pools).toHaveLength(1);
    expect(mocks.clients).toHaveLength(1);
  });

  it("shares the existing pool when the bridge is loaded before Prisma", async () => {
    const { bridgePool } = await import("./donor-bridge");
    await import("./db");
    expect(mocks.adapters).toEqual([bridgePool]);
    expect(mocks.pools).toHaveLength(1);
  });

  it("handles idle-connection errors without an unhandled error event", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await import("./database-pool");
    const [event, handler] = mocks.pools[0].on.mock.calls[0];
    expect(event).toBe("error");
    handler(new Error("connection terminated"));
    expect(log).toHaveBeenCalledWith("DB pool error (non-fatal):", "connection terminated");
  });
});
