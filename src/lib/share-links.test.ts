import { describe, expect, it } from "vitest";
import { createShareCode, shareBotUrl, shareStartCode, shareTargetPath } from "./share-links";

describe("Sentinel short share links", () => {
  it("creates Telegram-safe eight-character codes", () => {
    expect(createShareCode()).toMatch(/^[A-Za-z0-9_-]{8}$/);
  });

  it("maps supported entities to focused Sentinel destinations", () => {
    expect(shareTargetPath("openrouter-key", "key/1")).toBe("/admin/openrouter?shared=openrouter-key%3Akey%2F1&keyId=key%2F1#shared-key%2F1");
    expect(shareTargetPath("service", "svc1")).toBe("/admin/services/svc1?shared=service%3Asvc1#shared-svc1");
  });

  it("accepts only the dedicated bot payload shape", () => {
    expect(shareStartCode("share_abCD12_-" )).toBe("abCD12_-");
    expect(shareStartCode("auth_abCD12_-" )).toBeNull();
    expect(shareStartCode("share_short" )).toBe("");
  });

  it("shares directly into the Sentinel bot chat", () => {
    const username = process.env.BOT_USERNAME?.trim().replace(/^@/, "") || "TheSentinelRobot";
    expect(shareBotUrl("abCD12_-")).toBe(`https://t.me/${username}?start=share_abCD12_-`);
  });
});
