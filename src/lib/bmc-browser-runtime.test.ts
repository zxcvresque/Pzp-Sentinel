import { expect, it } from "vitest";
import { bmcBrowserLaunchOptions, bmcBrowserStartupProblem, managedBmcBrowserPath } from "./bmc-browser-runtime.mjs";
import { profile } from "../../scripts/setup-bmc-browser.mjs";
const bundled = "/home/ubuntu/.cache/ms-playwright/chromium-1255/chrome-linux-arm64/chrome";
it("selects the version-matched, root-owned browser on the affected Linux VPS", () => {
  expect(managedBmcBrowserPath(bundled, "arm64")).toBe("/opt/sentinel-bmc-browser/chromium-1255-arm64/chrome");
  expect(bmcBrowserLaunchOptions(bundled, { platform: "linux", architecture: "arm64", executablePath: "", exists: () => true })).toMatchObject({ executablePath: "/opt/sentinel-bmc-browser/chromium-1255-arm64/chrome", chromiumSandbox: true });
});
it("keeps the existing bundled browser when server setup is absent", () => {
  const options = bmcBrowserLaunchOptions(bundled, { platform: "linux", architecture: "arm64", executablePath: "", exists: () => false });
  expect(options).not.toHaveProperty("executablePath"); expect(options.chromiumSandbox).toBe(true);
});
it("honours an explicitly configured browser and never disables its sandbox", () => {
  const options = bmcBrowserLaunchOptions(bundled, { platform: "linux", executablePath: "/usr/bin/chromium", exists: () => true });
  expect(options).toMatchObject({ executablePath: "/usr/bin/chromium", chromiumSandbox: true });
  expect(options).not.toHaveProperty("args");
});
it("does not select a managed Linux executable on macOS", () => {
  expect(bmcBrowserLaunchOptions(bundled, { platform: "darwin", executablePath: "", exists: () => true })).not.toHaveProperty("executablePath");
});
it.each(["armv7", "../../tmp", ""]) ("rejects unsupported architectures for managed browser paths: %s", architecture => {
  expect(managedBmcBrowserPath(bundled, architecture as typeof process.arch)).toBeNull();
});
it("classifies the actual VPS sandbox failure with a specific recovery action", () => {
  const problem = bmcBrowserStartupProblem(Error("browserType.launch: Target page closed\nChromium sandboxing failed!\nNo usable sandbox! Ubuntu AppArmor restricts user namespaces"));
  expect(problem).toMatchObject({ code: "BROWSER_SANDBOX_BLOCKED", recoveryCommand: "node scripts/setup-bmc-browser.mjs --apply" });
});
it("distinguishes a missing browser from missing Linux libraries without returning raw logs", () => {
  expect(bmcBrowserStartupProblem(Error("Executable doesn't exist at /private/home/chrome"))).toMatchObject({ code: "BROWSER_NOT_INSTALLED" });
  expect(bmcBrowserStartupProblem(Error("error while loading shared libraries: libnspr.so: cannot open shared object file"))).toMatchObject({ code: "BROWSER_DEPENDENCIES_MISSING" });
  expect(JSON.stringify(bmcBrowserStartupProblem(Error("private-password unexpected /home/private/log")))).not.toMatch(/private-password|\/home\/private/);
});
it("limits the AppArmor exception to root-owned Sentinel browser paths", () => {
  expect(profile).toContain("/opt/sentinel-bmc-browser/chromium-*/chrome");
  expect(profile).toContain("userns,");
  expect(profile).not.toMatch(/\/home\/|\.cache|sysctl|restrict_unprivileged_userns|capability,/);
});
