import { describe, expect, it } from "vitest";
import {
  mergeUiConfigPatch,
  sanitizeNotificationUiConfigPatch,
  resolveNotificationPreferencesFromUiConfig,
  withStationAlertsPlanGate,
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

  it("turns boolean owner-alert prefs off below Scale", () => {
    const gated = withStationAlertsPlanGate(
      {
        newOrderPushEnabled: true,
        paymentReminderEnabled: true,
        dormantPushHour: 7,
      },
      false,
    );
    expect(gated.newOrderPushEnabled).toBe(false);
    expect(gated.paymentReminderEnabled).toBe(false);
    expect(gated.dormantPushHour).toBe(7);
  });

  it("ignores stored River AI brief and collections pulse prefs", () => {
    const prefs = resolveNotificationPreferencesFromUiConfig({
      autoMorningBriefEnabled: true,
      morningBriefEmailEnabled: true,
      autoCollectionsPulseEnabled: true,
      paymentReminderEmailEnabled: true,
    });
    expect(prefs.autoMorningBriefEnabled).toBe(false);
    expect(prefs.morningBriefEmailEnabled).toBe(false);
    expect(prefs.autoCollectionsPulseEnabled).toBe(false);
    expect(prefs.paymentReminderEmailEnabled).toBe(true);
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
