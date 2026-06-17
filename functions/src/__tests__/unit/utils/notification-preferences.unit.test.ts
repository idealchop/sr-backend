import { describe, expect, it } from "vitest";
import {
  mergeUiConfigPatch,
  sanitizeNotificationUiConfigPatch,
} from "../../../utils/notification-preferences";

describe("notification-preferences (backend)", () => {
  it("sanitizes boolean and hour fields", () => {
    const patch = sanitizeNotificationUiConfigPatch({
      dormantPushEnabled: true,
      dormantPushHour: 7,
      dormantPushHourBad: 15,
      theme: "dark",
    });
    expect(patch).toEqual({ dormantPushEnabled: true, dormantPushHour: 7 });
  });

  it("drops invalid push hour from merge", () => {
    const merged = mergeUiConfigPatch(
      { dormantPushHour: 7, theme: "light" },
      { dormantPushHour: 99, dormantPushEnabled: true, theme: "dark" },
    );
    expect(merged.dormantPushHour).toBe(7);
    expect(merged.dormantPushEnabled).toBe(true);
    expect(merged.theme).toBe("dark");
  });

  it("sanitizes plant ops and reorder push keys", () => {
    const patch = sanitizeNotificationUiConfigPatch({
      maintenancePushEnabled: true,
      productionVariancePushEnabled: false,
      reorderPushEnabled: true,
      reorderAlertDaysAhead: 5,
      reorderAlertDaysAheadBad: 99,
    });
    expect(patch).toEqual({
      maintenancePushEnabled: true,
      productionVariancePushEnabled: false,
      reorderPushEnabled: true,
      reorderAlertDaysAhead: 5,
    });
  });
});
