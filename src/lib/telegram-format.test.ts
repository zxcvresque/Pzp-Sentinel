import { describe, expect, it } from "vitest";
import { formatTelegramIdentity } from "./telegram-format";

describe("formatTelegramIdentity", () => {
  it("includes name, username, and mandatory Telegram ID", () => {
    expect(formatTelegramIdentity({
      name: "Varad",
      username: "@varad",
      telegramId: "1800754304",
    })).toBe("Name: <b>Varad</b>\nUsername: @varad\nID: <code>1800754304</code>");
  });

  it("omits the optional username while retaining the Telegram ID", () => {
    expect(formatTelegramIdentity({
      name: "One-time donor",
      telegramId: "6153200139",
    })).toBe("Name: <b>One-time donor</b>\nID: <code>6153200139</code>");
  });

  it("escapes Telegram HTML fields", () => {
    expect(formatTelegramIdentity({
      name: "A&B <Donor>",
      username: "a&b",
      telegramId: "<123>",
    })).toBe("Name: <b>A&amp;B &lt;Donor&gt;</b>\nUsername: @a&amp;b\nID: <code>&lt;123&gt;</code>");
  });
});
