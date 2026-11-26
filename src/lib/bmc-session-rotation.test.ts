import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fetchBmcDashboardJson, bmcDashboardSession } from "./bmc-history";
import { mutateBmcSession, writeBmcPrivate } from "./bmc-private-store";
let dir: string;
const stored = { cookie: "session=old; XSRF-TOKEN=token", studioCookie: "studio=old", generation: "g1" };
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bmc-rotation-test-"));
  vi.stubEnv("BMC_DASHBOARD_SESSION_FILE", join(dir, "session.enc"));
  vi.stubEnv("CREDENTIAL_ENC_KEY", Buffer.alloc(32, 7).toString("base64"));
  await writeBmcPrivate(join(dir, "session.enc"), stored);
});
afterEach(async () => { vi.unstubAllGlobals(); await rm(dir, { recursive: true, force: true }); });
it("retains successful provider-issued rotations without exposing them in the API result", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [] }, { headers: { "Set-Cookie": "session=new; Path=/; Secure; HttpOnly" } })));
  const session = { ...stored };
  expect(await fetchBmcDashboardJson("https://app.buymeacoffee.com/api/v1/subscriptions?type=2&page=1", { session })).toEqual({ data: [] });
  expect((await bmcDashboardSession()).cookie).toContain("session=new");
  expect(session.cookie).toContain("session=new");
});
it("a response from a disconnected old session cannot recreate credentials", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => {
    await mutateBmcSession(() => null);
    return Response.json({ data: [] }, { headers: { "Set-Cookie": "session=new; Path=/" } });
  }));
  await fetchBmcDashboardJson("https://app.buymeacoffee.com/api/v1/subscriptions?type=2&page=1", { session: { ...stored } });
  await expect(bmcDashboardSession()).rejects.toMatchObject({ code: "SESSION_NOT_CONFIGURED" });
});
it("a response from an old connection cannot overwrite a new one", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => {
    await mutateBmcSession(() => ({ ...stored, cookie: "session=reconnected", generation: "g2" }));
    return Response.json({ data: [] }, { headers: { "Set-Cookie": "session=obsolete; Path=/" } });
  }));
  await fetchBmcDashboardJson("https://app.buymeacoffee.com/api/v1/subscriptions?type=2&page=1", { session: { ...stored } });
  expect((await bmcDashboardSession()).cookie).toBe("session=reconnected");
});
