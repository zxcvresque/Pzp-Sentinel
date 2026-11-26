import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import BmcResponseView from "@/components/BmcResponseView";

it("renders complete saved answers with safe rich text and separate quoted additions", () => {
  const html = renderToStaticMarkup(createElement(BmcResponseView, { feedback: {
    wantedToDonate: true, deliberateCancellation: null,
    reason: "**Card declined**\n*Please check October.* <script>alert(1)</script>",
    additionalInfo: "Updated [receipt](https://example.com/receipt)",
  } }));
  expect(html).toContain("<strong");
  expect(html).toContain("<em>Please check October.</em>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html.match(/<blockquote/g)).toHaveLength(2);
  expect(html).toContain("Not asked");
  expect(html).toContain('href="https://example.com/receipt"');
});
