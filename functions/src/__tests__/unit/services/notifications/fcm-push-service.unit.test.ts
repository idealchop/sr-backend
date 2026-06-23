import { describe, expect, it } from "vitest";
import { isPushBlockedByQuietHours } from "../../../../services/notifications/fcm-push-service";

describe("isPushBlockedByQuietHours", () => {
  it("blocks overnight window 22 → 6 in Manila", () => {
    const lateNight = new Date("2026-06-02T17:30:00.000Z"); // 01:30 Manila
    expect(isPushBlockedByQuietHours(lateNight, 22, 6)).toBe(true);
  });

  it("allows daytime within 22 → 6 window", () => {
    const morning = new Date("2026-06-02T02:00:00.000Z"); // 10:00 Manila
    expect(isPushBlockedByQuietHours(morning, 22, 6)).toBe(false);
  });

  it("never blocks new_order critical type via send options (helper only checks hours)", () => {
    const lateNight = new Date("2026-06-02T17:30:00.000Z");
    expect(isPushBlockedByQuietHours(lateNight, undefined, undefined)).toBe(false);
  });
});
