import { existsSync } from "node:fs";

/** Root-owned browser copy whose AppArmor permission is limited to this path. */
export function managedBmcBrowserPath(bundledExecutable, architecture = process.arch) {
  const revision = bundledExecutable.match(/[/\\]chromium-(\d+)[/\\]/)?.[1];
  if (!revision || !["arm64", "x64"].includes(architecture)) return null;
  return `/opt/sentinel-bmc-browser/chromium-${revision}-${architecture}/chrome`;
}

export function bmcBrowserLaunchOptions(bundledExecutable, options = {}) {
  const platform = options.platform || process.platform;
  const configured = options.executablePath ?? process.env.BMC_CHROMIUM_EXECUTABLE;
  const managed = managedBmcBrowserPath(bundledExecutable, options.architecture);
  const installed = options.exists || existsSync;
  const executablePath = configured || (platform === "linux" && managed && installed(managed) ? managed : undefined);
  return { headless: true, chromiumSandbox: true, timeout: 20000, ...(executablePath ? { executablePath } : {}) };
}

export function bmcBrowserStartupProblem(error) {
  // Chromium launch errors cannot contain credentials: no login context exists yet.
  // Return classifications, never raw browser logs, paths or environment values.
  const message = error instanceof Error ? error.message : "";
  if (/No usable sandbox|sandboxing failed|apparmor|Failed to move to new namespace|Operation not permitted.*namespace/i.test(message)) return {
    code: "BROWSER_SANDBOX_BLOCKED",
    message: "Ubuntu is blocking the private browser’s sandbox. A server administrator must run the BMC browser setup, then retry connecting.",
    recoveryCommand: "node scripts/setup-bmc-browser.mjs --apply",
  };
  if (/Executable doesn.t exist|executable.*not found|ENOENT/i.test(message)) return {
    code: "BROWSER_NOT_INSTALLED", message: "The private login browser is missing on the server. Install it, then retry connecting.", recoveryCommand: "npx playwright install --with-deps chromium",
  };
  if (/error while loading shared libraries|Host system is missing dependencies|cannot open shared object file/i.test(message)) return {
    code: "BROWSER_DEPENDENCIES_MISSING", message: "The private login browser needs Linux system libraries. Install them on the server, then retry connecting.", recoveryCommand: "npx playwright install-deps chromium",
  };
  return { code: "BROWSER_UNAVAILABLE", message: "The private login browser could not start. Run the browser check on the server to identify the problem.", recoveryCommand: "node scripts/check-bmc-browser.mjs" };
}
