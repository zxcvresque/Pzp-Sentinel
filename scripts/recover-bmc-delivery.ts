import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { bmcRecoverySignature } from "../src/lib/bmc-webhook";

async function main() {
  const fileFlag = process.argv.indexOf("--file");
  const fileName = fileFlag >= 0 ? process.argv[fileFlag + 1] : null;
  if (!fileName) throw new Error("Usage: npm run bmc:recover -- --file <failed-delivery.json>");

  const secret = process.env.BMC_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("BMC_WEBHOOK_SECRET is not configured");

  const parsed = JSON.parse(await readFile(resolve(fileName), "utf8")) as unknown;
  const deliveries = Array.isArray(parsed) ? parsed : [parsed];
  if (!deliveries.length) throw new Error("The recovery file contains no deliveries");

  // Import after dotenv is loaded so the normal webhook processor sees the
  // same production configuration as the running application.
  const { POST } = await import("../src/app/api/bmc/webhook/route");
  let failed = false;
  for (const delivery of deliveries) {
    const rawBody = JSON.stringify(delivery);
    const request = new NextRequest("http://sentinel.internal/api/bmc/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sentinel-bmc-recovery-sha256": bmcRecoverySignature(rawBody, secret),
      },
      body: rawBody,
    });
    const response = await POST(request);
    const result = await response.json() as Record<string, unknown>;
    console.log(JSON.stringify({ httpStatus: response.status, ...result }));
    if (!response.ok) failed = true;
  }

  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
