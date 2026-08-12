import { describe, expect, it } from "vitest";
import { broadcastInlineToTelegramHtml, broadcastToTelegramHtml } from "./broadcast-format";

describe("broadcast formatting", () => {
  it("converts the supported rich-text syntax to Telegram HTML", () => {
    expect(broadcastToTelegramHtml("**Bold** *italics* __under__ ~~gone~~ `code`\n> A quote"))
      .toBe("<b>Bold</b> <i>italics</i> <u>under</u> <s>gone</s> <code>code</code>\n<blockquote>A quote</blockquote>");
  });

  it("escapes HTML and only links safe web URLs", () => {
    expect(broadcastToTelegramHtml("<b>x</b> [Site](https://example.com) [Bad](javascript:alert(1))"))
      .toBe("&lt;b&gt;x&lt;/b&gt; <a href=\"https://example.com/\">Site</a> [Bad](javascript:alert(1))");
  });

  it("formats a rich title without creating block elements", () => {
    expect(broadcastInlineToTelegramHtml("**Sentinel** *stands watch*"))
      .toBe("<b>Sentinel</b> <i>stands watch</i>");
  });
});
