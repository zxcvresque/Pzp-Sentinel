import { describe, expect, it } from "vitest";
import { enumValue, httpUrl, isTelegramId, normalizeTelegramUsername, positiveAmount, trimmedString } from "./validation";

describe("shared validation", () => {
  it("normalizes bounded strings and Telegram usernames", () => {
    expect(trimmedString("  hello  ", { max: 10 })).toBe("hello");
    expect(trimmedString("too long", { max: 3 })).toBeNull();
    expect(normalizeTelegramUsername(" @valid_user ")).toBe("valid_user");
    expect(normalizeTelegramUsername("bad-name")).toBeNull();
  });

  it("validates IDs, enums, positive amounts and web URLs", () => {
    expect(isTelegramId("123456789")).toBe(true);
    expect(isTelegramId("123abc")).toBe(false);
    expect(enumValue("ACTIVE", ["ACTIVE", "INACTIVE"] as const)).toBe("ACTIVE");
    expect(enumValue("ROOT", ["ACTIVE", "INACTIVE"] as const)).toBeNull();
    expect(positiveAmount("10.50")).toBe(10.5);
    expect(positiveAmount(0)).toBeNull();
    expect(httpUrl("https://example.com/path")).toBe("https://example.com/path");
    expect(httpUrl("javascript:alert(1)")).toBeNull();
  });
});
