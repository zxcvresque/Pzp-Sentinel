import { expect, it } from "vitest";
import { startMessage } from "./start-message";

it("keeps registration pending without exposing a role dashboard", () => {
  const result = startMessage({ name: "New member", roles: [] });
  expect(result.text).toContain("Access is for registered members");
  expect(result.text).not.toMatch(/developer|treasury/i);
  expect(result.route).toBeNull();
});
it("shows only donor features to a donor", () => {
  const result = startMessage({ name: "Donor", roles: ["DONOR"] });
  expect(result.text).toContain("donation history");
  expect(result.text).not.toMatch(/developer|tasks|treasury|servers/i);
  expect(result.route).toBe("/donor");
});
it("personalizes developer, admin and combined access", () => {
  expect(startMessage({ name: "Dev", roles: ["DEV"] })).toMatchObject({ route: "/dev" });
  expect(startMessage({ name: "Admin", roles: ["ADMIN"] }).text).toContain("treasury");
  const result = startMessage({ name: "Both", roles: ["DONOR", "DEV"] });
  expect(result.text).toContain("Developer");
  expect(result.text).toContain("Donor");
  expect(result.text).not.toContain("Admin");
});
it("escapes names and denies inactive accounts even when they retain roles", () => {
  expect(startMessage({ name: "<b>&", roles: ["DONOR"] }).text).toContain("&lt;b&gt;&amp;");
  expect(startMessage({ name: "Inactive", roles: ["ADMIN"], status: "INACTIVE" }).route).toBeNull();
});
