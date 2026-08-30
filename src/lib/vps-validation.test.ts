import { describe, expect, it } from "vitest";
import { isValidSshUsername, isValidVpsHost, parseSshPort } from "./vps-validation";

describe("VPS connection validation", () => {
  it("accepts ordinary hosts and IP addresses", () => {
    expect(isValidVpsHost("server.example.com")).toBe(true);
    expect(isValidVpsHost("203.0.113.10")).toBe(true);
    expect(isValidVpsHost("2001:db8::1")).toBe(true);
  });

  it("rejects host and username shell payloads", () => {
    expect(isValidVpsHost("host$(touch /tmp/pwned)")).toBe(false);
    expect(isValidVpsHost("host;reboot")).toBe(false);
    expect(isValidSshUsername("root; reboot")).toBe(false);
    expect(isValidSshUsername("deploy_user-1")).toBe(true);
  });

  it("requires a real TCP port", () => {
    expect(parseSshPort(22)).toBe(22);
    expect(parseSshPort("65535")).toBe(65535);
    expect(parseSshPort(0)).toBeNull();
    expect(parseSshPort("22; reboot")).toBeNull();
  });
});
