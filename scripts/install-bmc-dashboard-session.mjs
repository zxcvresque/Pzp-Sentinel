// node --env-file=.env scripts/install-bmc-dashboard-session.mjs /private/path/request-headers.txt
// Accepts a DevTools headers capture. Never prints credentials or contacts BMC.
import { readFile, mkdir, writeFile, rename, chmod } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomBytes, createCipheriv } from "node:crypto";

const source = process.argv[2];
if (!source) throw new Error("Supply a private DevTools request-headers text file.");
const lines = (await readFile(source, "utf8")).split(/\r?\n/);
function header(name) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.toLowerCase() === name) return lines[i + 1]?.trim();
    if (line.toLowerCase().startsWith(`${name}:`)) return line.slice(name.length + 1).trim();
  }
}
const cookie = header("cookie");
const xsrfToken = header("x-xsrf-token");
if (!cookie || !cookie.includes("=") || /[\r\n]/.test(cookie)) throw new Error("No valid Cookie request header found. Use request headers, not response headers.");
const key = Buffer.from(process.env.CREDENTIAL_ENC_KEY || "", "base64");
if (key.length !== 32) throw new Error("Load the Sentinel server's CREDENTIAL_ENC_KEY before installing the session.");
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
const encrypted = Buffer.concat([cipher.update(JSON.stringify({ cookie, xsrfToken }), "utf8"), cipher.final()]);
const stored = `enc:v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
const destination = resolve(process.env.BMC_DASHBOARD_SESSION_FILE || "data/bmc-dashboard/session.enc");
await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
const temporary = `${destination}.${randomBytes(8).toString("hex")}.tmp`;
await writeFile(temporary, stored, { mode: 0o600, flag: "wx" });
await rename(temporary, destination);
await chmod(destination, 0o600);
console.log("Encrypted BMC dashboard session installed. No ledger or XP records were changed.");
