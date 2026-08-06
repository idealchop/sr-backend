import { describe, expect, it } from "vitest";
import {
  assertRegistrationOpen,
  isRegistrationOpen,
  isWebinarJoinWindowOpen,
  toIsoTimestamp,
} from "../../../../services/events-training/webinar-registration-window";

describe("webinar-registration-window", () => {
  it("treats missing registrationOpensAt as open", () => {
    expect(isRegistrationOpen({})).toBe(true);
    expect(isRegistrationOpen({ registrationOpensAt: null })).toBe(true);
  });

  it("blocks before registrationOpensAt", () => {
    const opensAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect(isRegistrationOpen({ registrationOpensAt: opensAt })).toBe(false);
    expect(() => assertRegistrationOpen({ registrationOpensAt: opensAt })).toThrow(
      /Registration opens/,
    );
    try {
      assertRegistrationOpen({ registrationOpensAt: opensAt });
    } catch (error) {
      expect((error as { code?: string }).code).toBe("REGISTRATION_NOT_OPEN");
    }
  });

  it("allows after registrationOpensAt", () => {
    const opensAt = new Date(Date.now() - 60 * 1000).toISOString();
    expect(isRegistrationOpen({ registrationOpensAt: opensAt })).toBe(true);
  });

  it("opens join window 15 minutes before start", () => {
    const start = Date.now() + 10 * 60 * 1000;
    const startsAt = new Date(start).toISOString();
    const endsAt = new Date(start + 2 * 60 * 60 * 1000).toISOString();
    expect(isWebinarJoinWindowOpen(startsAt, endsAt)).toBe(true);
  });

  it("keeps join closed more than 15 minutes before start", () => {
    const start = Date.now() + 30 * 60 * 1000;
    const startsAt = new Date(start).toISOString();
    expect(isWebinarJoinWindowOpen(startsAt, null)).toBe(false);
  });

  it("parses Firestore-like timestamps", () => {
    const d = new Date("2026-08-01T02:00:00.000Z");
    expect(toIsoTimestamp({ toDate: () => d })).toBe(d.toISOString());
  });
});
