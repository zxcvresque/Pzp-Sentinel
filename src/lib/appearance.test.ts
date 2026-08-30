import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUBTEXT_COLOR,
  SUBTEXT_COLOR_PRESETS,
  contrastRatio,
  isReadableSubtextColor,
} from "./appearance";

describe("subtext colors", () => {
  it("keeps the default and every preset readable on cards", () => {
    for (const color of [DEFAULT_SUBTEXT_COLOR, ...SUBTEXT_COLOR_PRESETS.map((preset) => preset.color)]) {
      expect(contrastRatio(color)).toBeGreaterThanOrEqual(4.5);
      expect(isReadableSubtextColor(color)).toBe(true);
    }
  });

  it("rejects malformed and low-contrast custom colors", () => {
    expect(isReadableSubtextColor("#33333A")).toBe(false);
    expect(isReadableSubtextColor("blue")).toBe(false);
  });
});
