import { describe, expect, it } from "vitest";
import {
  formatFirestorePhilippineDateTime,
  formatPhilippineDateTime,
} from "../../../utils/philippine-datetime";

describe("philippine-datetime", () => {
  it("formats UTC instant as Manila wall clock", () => {
    const instant = new Date("2026-06-07T14:30:00.000Z");
    expect(formatPhilippineDateTime(instant)).toMatch(/10:30\s*PM/i);
  });

  it("formats Firestore seconds in Manila timezone", () => {
    const out = formatFirestorePhilippineDateTime({
      seconds: Math.floor(new Date("2026-06-07T14:30:00.000Z").getTime() / 1000),
    });
    expect(out).toMatch(/10:30\s*PM/i);
  });
});
