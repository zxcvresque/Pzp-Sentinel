import { expect, it } from "vitest";
import { displayDate, displayDateTime } from "./date-format";

it("renders an unambiguous DD/MM/YYYY date across browsers and servers", () => {
  expect(displayDate("2026-09-11T12:00:00Z")).toBe("11/09/2026");
  expect(displayDate("2026-08-30")).toBe("30/08/2026");
});
it("keeps time and date aligned across the IST midnight boundary", () => {
  expect(displayDateTime("2026-09-10T18:31:00Z")).toBe("11/09/2026, 00:01");
  expect(displayDate("2026-09-10T18:31:00Z", "UTC")).toBe("10/09/2026");
});
it("handles absent and invalid dates without crashing a page", () => {
  expect(displayDate(null)).toBe("—");
  expect(displayDateTime("bad date")).toBe("—");
});
