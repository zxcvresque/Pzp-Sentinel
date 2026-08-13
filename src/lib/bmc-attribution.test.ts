import { describe, expect, it } from "vitest";
import {
  extractBmcAttributionCode,
  generateBmcAttributionCode,
  hashBmcAttributionCode,
} from "./bmc-attribution";

describe("BMC donor attribution codes", () => {
  it("generates a copyable 80-bit code and stores it by hash", () => {
    const code = generateBmcAttributionCode();
    expect(code).toMatch(/^PZP-BMC-[A-F0-9]{4}(?:-[A-F0-9]{4}){4}$/);
    expect(hashBmcAttributionCode(code)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashBmcAttributionCode(code.toLowerCase())).toBe(hashBmcAttributionCode(code));
  });

  it("extracts the code from a longer supporter note", () => {
    const code = "PZP-BMC-A1B2-C3D4-E5F6-0789-ABCD";
    expect(extractBmcAttributionCode(`Thank you! ${code} keep building`)).toBe(code);
    expect(extractBmcAttributionCode("No Sentinel reference")).toBeNull();
  });
});
