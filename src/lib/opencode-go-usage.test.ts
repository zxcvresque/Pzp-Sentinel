import { describe, expect, it } from "vitest";
import {
  normalizeAuthCookie,
  normalizeWorkspaceId,
  OpenCodeUsageError,
  parseOpenCodeUsage,
} from "./opencode-go-usage";

const now = new Date("2026-07-19T12:00:00.000Z");

describe("parseOpenCodeUsage", () => {
  it("parses all windows from the live Solid hydration shape", () => {
    const text =
      '_$HY.r["lite.subscription.get[\\"wrk_LIVE123\\"]"]=$R[17];' +
      '$R[24]($R[18],$R[27]={mine:!0,useBalance:!1,' +
      'rollingUsage:$R[28]={status:"ok",resetInSec:17591,usagePercent:12},' +
      'weeklyUsage:$R[29]={status:"ok",resetInSec:444552,usagePercent:30},' +
      'monthlyUsage:$R[30]={status:"ok",resetInSec:2591424,usagePercent:55}});';

    const result = parseOpenCodeUsage(text, now);

    expect(result.windows.map((window) => [window.key, window.usedPercent])).toEqual([
      ["rolling", 12],
      ["weekly", 30],
      ["monthly", 55],
    ]);
    expect(result.windows[0].resetsAt).toBe("2026-07-19T16:53:11.000Z");
  });

  it("keeps real zeroes and permits optional weekly/monthly windows", () => {
    const result = parseOpenCodeUsage(
      '$R[1]={rollingUsage:$R[2]={usagePercent:0,resetInSec:300}}',
      now,
    );
    expect(result.windows).toHaveLength(1);
    expect(result.windows[0].usedPercent).toBe(0);
  });

  it("parses nested JSON and used/limit fallbacks", () => {
    const result = parseOpenCodeUsage(JSON.stringify({
      data: {
        rollingUsage: { used: 3, limit: 12, resetInSec: 600 },
        weeklyUsage: { usagePercent: 40, resetInSeconds: 7200 },
      },
    }), now);
    expect(result.windows[0].usedPercent).toBe(25);
    expect(result.windows[1].usedPercent).toBe(40);
  });

  it("clamps impossible percentages", () => {
    const result = parseOpenCodeUsage(
      '$R={rollingUsage:{usagePercent:150,resetInSec:60},weeklyUsage:{usagePercent:-5,resetInSec:60}}',
      now,
    );
    expect(result.windows.map((window) => window.usedPercent)).toEqual([100, 0]);
  });

  it("fails instead of presenting a misleading zero", () => {
    expect(() => parseOpenCodeUsage("<html>changed upstream</html>", now)).toThrow(OpenCodeUsageError);
  });
});

describe("OpenCode credential normalization", () => {
  it("accepts raw workspace IDs and dashboard URLs", () => {
    expect(normalizeWorkspaceId("wrk_ABC123")).toBe("wrk_ABC123");
    expect(normalizeWorkspaceId("https://opencode.ai/workspace/wrk_XYZ987/go")).toBe("wrk_XYZ987");
  });

  it("extracts only the auth cookie", () => {
    expect(normalizeAuthCookie("foo=bar; auth=Fe26.2**secret; theme=dark")).toBe("auth=Fe26.2**secret");
    expect(normalizeAuthCookie("Fe26.2**secret")).toBe("auth=Fe26.2**secret");
  });
});
