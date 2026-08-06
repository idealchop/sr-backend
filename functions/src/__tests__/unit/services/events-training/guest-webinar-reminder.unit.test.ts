import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../config/firebase-admin", () => ({
  db: {},
  FieldValue: { serverTimestamp: () => "SERVER_TS" },
}));

vi.mock("../../../../services/events-training/events-training-collections", () => ({
  webinarsCollection: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
  webinarRegistrationsCollection: () => ({
    where: () => ({
      where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
      limit: () => ({ get: async () => ({ docs: [] }) }),
    }),
    doc: () => ({ set: async () => undefined }),
  }),
}));

vi.mock("../../../../utils/brevo", () => ({
  getBrevoApi: () => ({ sendTransacEmail: vi.fn() }),
  brevo: { SendSmtpEmail: class {} },
}));

vi.mock("../../../../utils/app-base-url", () => ({
  resolveMarketingSiteBaseUrl: () => "https://smartrefill.io",
}));

import {
  isWithinGuestReminderWindow,
  REMINDER_WINDOW_MAX_MS,
  REMINDER_WINDOW_MIN_MS,
} from "../../../../services/events-training/guest-webinar-reminder-service";
import { isCmsGuestRegistrationAllowed } from "../../../../services/events-training/guest-webinar-eligibility";
import { buildGuestWebinarReminderEmail } from "../../../../utils/guest-webinar-invite-email-template";

describe("isWithinGuestReminderWindow", () => {
  const now = Date.parse("2026-07-30T10:00:00.000Z");

  it("is true around T-1h", () => {
    const start = new Date(now + 60 * 60 * 1000).toISOString();
    expect(isWithinGuestReminderWindow(start, now)).toBe(true);
  });

  it("is false too early or too late", () => {
    expect(
      isWithinGuestReminderWindow(
        new Date(now + REMINDER_WINDOW_MAX_MS + 1).toISOString(),
        now,
      ),
    ).toBe(false);
    expect(
      isWithinGuestReminderWindow(
        new Date(now + REMINDER_WINDOW_MIN_MS - 1).toISOString(),
        now,
      ),
    ).toBe(false);
  });
});

describe("isCmsGuestRegistrationAllowed", () => {
  it("defaults public guests on when flag missing", () => {
    expect(isCmsGuestRegistrationAllowed({ visibility: "public" })).toBe(true);
  });

  it("respects explicit false on public", () => {
    expect(
      isCmsGuestRegistrationAllowed({
        visibility: "public",
        guestRegistrationEnabled: false,
      }),
    ).toBe(false);
  });
});

describe("buildGuestWebinarReminderEmail", () => {
  it("includes join and cancel urls", () => {
    const tpl = buildGuestWebinarReminderEmail({
      displayName: "Ada",
      eventName: "Ops Masterclass",
      startsAtLabel: "Soon",
      timezone: "Asia/Manila",
      joinUrl: "https://smartrefill.io/join",
      cancelUrl: "https://smartrefill.io/cancel",
    });
    expect(tpl.subject).toContain("Ops Masterclass");
    expect(tpl.html).toContain("https://smartrefill.io/join");
    expect(tpl.html).toContain("https://smartrefill.io/cancel");
    expect(tpl.brevoTag).toBe("guest_webinar_reminder");
  });
});
