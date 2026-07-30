import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    runTransaction: vi.fn(),
  },
}));

vi.mock("../../../../services/events-training/events-training-collections", () => ({
  webinarsCollection: () => ({ doc: () => ({}) }),
  webinarRegistrationsCollection: () => ({ doc: () => ({}) }),
}));

vi.mock("../../../../services/events-training/member-registration-service", () => ({
  isWebinarAtCapacity: () => false,
}));

import {
  guestRegistrationDocId,
  hashJoinToken,
  isValidGuestEmail,
  mintJoinToken,
  normalizeGuestDisplayName,
  normalizeGuestEmail,
} from "../../../../services/events-training/guest-webinar-registration-service";

describe("guest webinar registration helpers", () => {
  it("normalizes email to lowercase trimmed", () => {
    expect(normalizeGuestEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });

  it("validates email shape", () => {
    expect(isValidGuestEmail("ada@example.com")).toBe(true);
    expect(isValidGuestEmail("not-an-email")).toBe(false);
    expect(isValidGuestEmail("")).toBe(false);
  });

  it("trims display name", () => {
    expect(normalizeGuestDisplayName("  Ada Lovelace  ")).toBe("Ada Lovelace");
    expect(normalizeGuestDisplayName("")).toBe("");
  });

  it("builds stable guest doc ids per event+email", () => {
    const a = guestRegistrationDocId("evt1", "ada@example.com");
    const b = guestRegistrationDocId("evt1", "ada@example.com");
    const c = guestRegistrationDocId("evt1", "other@example.com");
    const d = guestRegistrationDocId("evt2", "ada@example.com");
    expect(a).toBe(b);
    expect(a).toMatch(/^guest_[a-f0-9]{40}$/);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });

  it("hashes join tokens consistently", () => {
    const token = mintJoinToken();
    expect(token).toMatch(/^[a-f0-9]{48}$/);
    expect(hashJoinToken(token)).toBe(hashJoinToken(token));
    expect(hashJoinToken(token)).not.toBe(token);
  });
});
