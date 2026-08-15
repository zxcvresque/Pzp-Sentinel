import { describe, expect, it } from "vitest";
import { serviceReminderRepeat, serviceTemplate } from "./service-templates";

describe("service templates", () => {
  it("provides the requested common service templates", () => {
    expect(["SUPABASE", "VPS", "DOMAIN", "GITHUB"].map((id) => serviceTemplate(id)?.id)).toEqual([
      "SUPABASE", "VPS", "DOMAIN", "GITHUB",
    ]);
  });

  it("maps billing frequencies to reminder intervals", () => {
    expect(serviceReminderRepeat("WEEKLY")).toEqual({ repeatEvery: 1, repeatUnit: "WEEK" });
    expect(serviceReminderRepeat("MONTHLY")).toEqual({ repeatEvery: 1, repeatUnit: "MONTH" });
    expect(serviceReminderRepeat("YEARLY")).toEqual({ repeatEvery: 12, repeatUnit: "MONTH" });
    expect(serviceReminderRepeat("ONE_TIME")).toBeNull();
  });
});
