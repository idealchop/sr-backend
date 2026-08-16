import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../config/firebase-admin", () => ({
  db: {},
}));

vi.mock("../../../../services/events-training/events-training-collections", () => ({
  webinarsCollection: () => ({ doc: () => ({}) }),
  webinarRegistrationsCollection: () => ({
    where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
    doc: () => ({ get: async () => ({ exists: false }) }),
  }),
}));

vi.mock("../../../../services/events-training/member-registration-service", () => ({
  isWebinarAtCapacity: () => false,
}));

import { buildGuestWebinarInviteEmail } from "../../../../utils/guest-webinar-invite-email-template";
import {
  GUEST_JOIN_EARLY_MS,
  isGuestJoinWindowOpen,
} from "../../../../services/events-training/guest-webinar-join-service";

describe("isGuestJoinWindowOpen", () => {
  const start = "2026-07-30T10:00:00.000Z";
  const end = "2026-07-30T12:00:00.000Z";
  const startMs = Date.parse(start);

  it("is closed before early window", () => {
    expect(
      isGuestJoinWindowOpen(start, end, startMs - GUEST_JOIN_EARLY_MS - 1),
    ).toBe(false);
  });

  it("opens 30 minutes before start", () => {
    expect(
      isGuestJoinWindowOpen(start, end, startMs - GUEST_JOIN_EARLY_MS),
    ).toBe(true);
  });

  it("stays open during the session", () => {
    expect(isGuestJoinWindowOpen(start, end, startMs + 30 * 60 * 1000)).toBe(
      true,
    );
  });

  it("closes at endsAt", () => {
    expect(isGuestJoinWindowOpen(start, end, Date.parse(end))).toBe(false);
  });

  it("uses 2h default duration when endsAt missing", () => {
    const twoHours = 2 * 60 * 60 * 1000;
    expect(isGuestJoinWindowOpen(start, null, startMs + twoHours - 1)).toBe(
      true,
    );
    expect(isGuestJoinWindowOpen(start, null, startMs + twoHours)).toBe(false);
  });

  it("returns false without startsAt", () => {
    expect(isGuestJoinWindowOpen(null, end, Date.now())).toBe(false);
  });
});

describe("buildGuestWebinarInviteEmail", () => {
  it("includes join url, cancel url, and event name", () => {
    const tpl = buildGuestWebinarInviteEmail({
      displayName: "Ada",
      eventName: "Ops Masterclass",
      startsAtLabel: "Thu, Jul 30, 2026, 6:00 PM",
      timezone: "Asia/Manila",
      joinUrl: "https://smartrefill.io/resources/webinars/join?t=abc",
      cancelUrl: "https://smartrefill.io/resources/webinars/cancel?t=abc",
      requiresApproval: false,
    });
    expect(tpl.subject).toContain("Ops Masterclass");
    expect(tpl.html).toContain(
      "https://smartrefill.io/resources/webinars/join?t=abc",
    );
    expect(tpl.html).toContain(
      "https://smartrefill.io/resources/webinars/cancel?t=abc",
    );
    expect(tpl.text).toContain("Join:");
    expect(tpl.text).toContain("Cancel:");
    expect(tpl.brevoTag).toBe("guest_webinar_invite");
  });

  it("uses pending subject when approval required", () => {
    const tpl = buildGuestWebinarInviteEmail({
      displayName: "Ada",
      eventName: "Ops Masterclass",
      startsAtLabel: "TBD",
      timezone: "Asia/Manila",
      joinUrl: "https://smartrefill.io/resources/webinars/join?t=abc",
      cancelUrl: "https://smartrefill.io/resources/webinars/cancel?t=abc",
      requiresApproval: true,
    });
    expect(tpl.subject.startsWith("Registration received")).toBe(true);
  });
});
