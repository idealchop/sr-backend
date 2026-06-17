import { describe, expect, it } from "vitest";
import {
  buildProductionShiftDocId,
  parseProductionShiftInput,
} from "../../../../services/plant/production-shift-validation";

describe("production-shift-validation", () => {
  it("builds stable document ids", () => {
    expect(buildProductionShiftDocId("2026-06-16", "AM")).toBe("2026-06-16_AM");
  });

  it("parses valid API payloads", () => {
    const result = parseProductionShiftInput({
      calendarDate: "2026-06-16",
      shift: "pm",
      gallonsProduced: 100,
      gallonsRejected: 0,
      notes: "  ok  ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.shift).toBe("PM");
      expect(result.value.notes).toBe("ok");
    }
  });

  it("rejects invalid shift", () => {
    const result = parseProductionShiftInput({
      calendarDate: "2026-06-16",
      shift: "NIGHT",
      gallonsProduced: 1,
    });
    expect(result.ok).toBe(false);
  });
});
