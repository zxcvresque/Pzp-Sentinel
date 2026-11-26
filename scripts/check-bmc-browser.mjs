import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { bmcBrowserLaunchOptions, bmcBrowserStartupProblem } from "../src/lib/bmc-browser-runtime.mjs";
let browser;
try {
  if (existsSync(".env")) process.loadEnvFile(".env");
  if (process.platform === "linux" && process.getuid?.() === 0) throw Error("Run this check as the non-root PM2 user.");
  browser = await chromium.launch(bmcBrowserLaunchOptions(chromium.executablePath()));
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("about:blank");
  await context.close();
  console.log("BMC private browser ready (sandbox enabled).");
} catch (error) {
  const problem = bmcBrowserStartupProblem(error);
  console.error(`${problem.code}: ${problem.message}\nRecovery: ${problem.recoveryCommand}`);
  process.exitCode = 1;
} finally { await browser?.close(); }
