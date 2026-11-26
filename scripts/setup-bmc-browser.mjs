// Preview: node scripts/setup-bmc-browser.mjs
// Apply:   node scripts/setup-bmc-browser.mjs --apply
// Run as the non-root PM2 user. Only filesystem installation/profile loading uses sudo.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import { managedBmcBrowserPath } from "../src/lib/bmc-browser-runtime.mjs";

const root = "/opt/sentinel-bmc-browser";
const profilePath = "/etc/apparmor.d/sentinel-bmc-browser";
export const profile = `# Managed by Sentinel's explicit BMC browser setup.\n# Only root-owned Sentinel Chromium copies receive user-namespace permission.\nabi <abi/4.0>,\ninclude <tunables/global>\n\nprofile sentinel-bmc-browser /opt/sentinel-bmc-browser/chromium-*/chrome flags=(unconfined) {\n  userns,\n}\n`;
function privileged(command, args) {
  return execFileSync("sudo", ["--", command, ...args], { stdio: "inherit" });
}
async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  if (process.platform !== "linux") throw Error("This setup is for Linux VPSes with Ubuntu AppArmor user-namespace restrictions.");
  if (process.getuid?.() === 0) throw Error("Run this as the non-root PM2 user; the installer requests sudo only for the system setup.");
  const source = chromium.executablePath();
  if (!existsSync(source)) throw Error("Install Chromium first: npx playwright install --with-deps chromium");
  const target = managedBmcBrowserPath(source);
  if (!target || !/^\/opt\/sentinel-bmc-browser\/chromium-\d+-(arm64|x64)\/chrome$/.test(target)) throw Error("Unsupported browser installation path or architecture.");
  if (!existsSync("/proc/sys/kernel/apparmor_restrict_unprivileged_userns") || readFileSync("/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "utf8").trim() !== "1") throw Error("AppArmor's user-namespace restriction is not enabled. Run node scripts/check-bmc-browser.mjs to diagnose the browser instead.");
  execFileSync("which", ["apparmor_parser"], { stdio: "ignore" });
  console.log(`Install root-owned Chromium: ${target}\nInstall/load AppArmor profile: ${profilePath}\nPermission: user namespaces for Sentinel's Chromium path only.\nChromium sandbox remains enabled. No global sysctl settings are changed.`);
  if (!process.argv.includes("--apply")) { console.log("Preview only. To apply this server security configuration: node scripts/setup-bmc-browser.mjs --apply"); return; }
  if (process.env.BMC_CHROMIUM_EXECUTABLE && process.env.BMC_CHROMIUM_EXECUTABLE !== target) throw Error("A custom BMC_CHROMIUM_EXECUTABLE is configured. Review that setting before installing the managed browser.");
  // A writable ancestor/symlink would defeat the executable allowlist.
  privileged("install", ["-d", "-o", "root", "-g", "root", "-m", "0755", root]);
  const rootInfo = execFileSync("stat", ["-c", "%u:%g:%a", root], { encoding: "utf8" }).trim();
  if (realpathSync(root) !== root || rootInfo !== "0:0:755") throw Error("The managed browser directory must be a real root-owned directory, mode 0755.");
  const targetDirectory = dirname(target);
  if (!existsSync(targetDirectory)) {
    const staging = execFileSync("sudo", ["--", "mktemp", "-d", `${root}/.install-XXXXXX`], { encoding: "utf8" }).trim();
    if (!/^\/opt\/sentinel-bmc-browser\/\.install-[a-zA-Z0-9]+$/.test(staging)) throw Error("Invalid temporary install path.");
    try {
      privileged("cp", ["-R", "--", `${dirname(source)}/.`, staging]);
      privileged("chown", ["-R", "root:root", staging]);
      privileged("chmod", ["-R", "u-s,g-s,go-w", staging]);
      privileged("chmod", ["0755", staging]);
      privileged("mv", ["-T", "--", staging, targetDirectory]);
    } catch (error) {
      privileged("rm", ["-rf", "--", staging]);
      throw error;
    }
  }
  // Refuse previously installed trees that could be replaced by the app user.
  privileged("test", ["!", "-L", targetDirectory]);
  privileged("test", ["!", "-L", target]);
  const unsafe = execFileSync("find", [targetDirectory, "-xdev", "(", "!", "-user", "root", "-o", "-perm", "/022", "-o", "-type", "l", ")", "-print", "-quit"], { encoding: "utf8" }).trim();
  if (unsafe) throw Error("The managed browser tree contains a non-root-owned, writable or symbolic-link entry. Review it before enabling namespaces.");
  const temporary = mkdtempSync(join(tmpdir(), "sentinel-bmc-apparmor-"));
  try {
    const file = join(temporary, "profile");
    writeFileSync(file, profile, { mode: 0o600 });
    privileged("apparmor_parser", ["-Q", file]);
    privileged("install", ["-o", "root", "-g", "root", "-m", "0644", file, profilePath]);
    privileged("apparmor_parser", ["-r", profilePath]);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
  const browser = await chromium.launch({ executablePath: target, chromiumSandbox: true, headless: true, timeout: 20000 });
  await browser.close();
  console.log("BMC private browser ready. Retry Reconnect in Incognito in Sentinel.");
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
