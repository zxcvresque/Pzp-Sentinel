import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret } from "./secret-crypto";

export function bmcDataDirectory() {
  return dirname(process.env.BMC_DASHBOARD_SESSION_FILE || "data/bmc-dashboard/session.enc");
}
export function bmcPrivatePath(name: string) { return join(bmcDataDirectory(), name); }
export function bmcSessionPath() { return process.env.BMC_DASHBOARD_SESSION_FILE || "data/bmc-dashboard/session.enc"; }

/** Serialize login, disconnect and cookie rotation across the web and bot processes. */
export async function mutateBmcSession<T>(change: (current: T | null) => Promise<T | null> | T | null) {
  await mkdir(bmcDataDirectory(), { recursive: true, mode: 0o700 });
  const lock = bmcPrivatePath("session.lock");
  let acquired = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { await mkdir(lock); acquired = true; break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const info = await stat(lock).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 30_000) await rm(lock, { recursive: true, force: true });
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  if (!acquired) throw new Error("BMC session is busy");
  try {
    const current = await readBmcPrivate<T>(bmcSessionPath());
    const next = await change(current);
    if (next === current) return;
    if (next === null) await rm(bmcSessionPath(), { force: true });
    else await writeBmcPrivate(bmcSessionPath(), next);
  } finally { await rm(lock, { recursive: true, force: true }); }
}

export async function readBmcPrivate<T>(path: string): Promise<T | null> {
  try {
    // These are runtime-owned secrets/evidence, not deployment assets.
    const value = await readFile(/* turbopackIgnore: true */ path, "utf8");
    if (!value.startsWith("enc:v1:")) throw new Error("Refusing plaintext BMC storage");
    return JSON.parse(decryptSecret(value.trim())) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeBmcPrivate(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, encryptSecret(JSON.stringify(value)), { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
