import { describe, expect, it } from "vitest";

import { buildDemoRequestIcs, toIcsUtc } from "../../../../services/marketing/demo-ics";
import {
  addDaysToDateKey,
  manilaWallTimeToUtc,
  parseRequestedDemoDateKey,
  parseRequestedDemoTime,
  resolveDemoSlot,
} from "../../../../services/marketing/demo-slot";

describe("parseRequestedDemoDateKey", () => {
  it("parses yyyy-MM-dd", () => {
    expect(parseRequestedDemoDateKey("2026-09-20")).toBe("2026-09-20");
  });

  it("parses PPP-like strings", () => {
    expect(parseRequestedDemoDateKey("September 17th, 2026")).toBe("2026-09-17");
    expect(parseRequestedDemoDateKey("September 17, 2026")).toBe("2026-09-17");
  });

  it("returns null for garbage", () => {
    expect(parseRequestedDemoDateKey("soon")).toBeNull();
    expect(parseRequestedDemoDateKey("")).toBeNull();
  });
});

describe("parseRequestedDemoTime", () => {
  it("parses HH:mm", () => {
    expect(parseRequestedDemoTime("14:00")).toEqual({ hour: 14, minute: 0 });
    expect(parseRequestedDemoTime("9:30")).toEqual({ hour: 9, minute: 30 });
  });

  it("defaults to 10:00 when missing or invalid", () => {
    expect(parseRequestedDemoTime(undefined)).toEqual({ hour: 10, minute: 0 });
    expect(parseRequestedDemoTime("noon")).toEqual({ hour: 10, minute: 0 });
    expect(parseRequestedDemoTime("25:00")).toEqual({ hour: 10, minute: 0 });
  });
});

describe("resolveDemoSlot", () => {
  it("schedules 10:00–11:00 Asia/Manila by default on the preferred date", () => {
    const now = new Date("2026-09-10T02:00:00.000Z"); // Sep 10 Manila morning
    const slot = resolveDemoSlot("2026-09-20", undefined, now);
    expect(slot.dateKey).toBe("2026-09-20");
    expect(slot.durationMinutes).toBe(60);
    expect(slot.startsAtIso).toBe(manilaWallTimeToUtc(2026, 9, 20, 10).toISOString());
    expect(slot.endsAtIso).toBe(manilaWallTimeToUtc(2026, 9, 20, 11).toISOString());
  });

  it("uses the preferred start time for a 1-hour window", () => {
    const now = new Date("2026-09-10T02:00:00.000Z");
    const slot = resolveDemoSlot("2026-09-20", "14:00", now);
    expect(slot.startsAtIso).toBe(manilaWallTimeToUtc(2026, 9, 20, 14).toISOString());
    expect(slot.endsAtIso).toBe(manilaWallTimeToUtc(2026, 9, 20, 15).toISOString());
    expect(slot.startHour).toBe(14);
  });

  it("falls back to next Manila day when date missing", () => {
    const now = new Date("2026-09-10T02:00:00.000Z");
    const slot = resolveDemoSlot(undefined, undefined, now);
    expect(slot.dateKey).toBe(addDaysToDateKey("2026-09-10", 1));
  });

  it("falls back to next Manila day when preferred date is in the past", () => {
    const now = new Date("2026-09-10T02:00:00.000Z");
    const slot = resolveDemoSlot("2026-09-01", "10:00", now);
    expect(slot.dateKey).toBe("2026-09-11");
  });
});

describe("buildDemoRequestIcs", () => {
  it("builds METHOD:REQUEST with Meet and attendees", () => {
    const slot = resolveDemoSlot(
      "2026-09-20",
      "14:00",
      new Date("2026-09-10T02:00:00.000Z"),
    );
    const ics = buildDemoRequestIcs({
      uid: "demo-test@smartrefill.io",
      slot,
      businessName: "Aqua Pure",
      inquireeName: "Juan",
      inquireeEmail: "juan@business.com",
      meetLink: "https://meet.google.com/abc-defg-hij",
    });

    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("SUMMARY:Smart Refill Demo — Aqua Pure");
    expect(ics).toContain("mailto:juan@business.com");
    expect(ics).toContain("mailto:support@riverph.com");
    expect(ics).toContain("mailto:jimboy@smartrefill.io");
    expect(ics).toContain("mailto:wina@riverph.com");
    expect(ics).toContain("https://meet.google.com/abc-defg-hij");
    expect(ics).toContain(`DTSTART:${toIcsUtc(slot.startsAt)}`);
    expect(ics).toContain(`DTEND:${toIcsUtc(slot.endsAt)}`);
  });
});
