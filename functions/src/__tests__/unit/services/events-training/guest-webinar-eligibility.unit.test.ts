import { describe, expect, it } from "vitest";
import { isCmsGuestRegistrationAllowed } from "../../../../services/events-training/guest-webinar-eligibility";

describe("isCmsGuestRegistrationAllowed", () => {
  it("defaults public guests on", () => {
    expect(isCmsGuestRegistrationAllowed({ visibility: "public" })).toBe(true);
  });

  it("honors public guest flag off", () => {
    expect(
      isCmsGuestRegistrationAllowed({
        visibility: "public",
        guestRegistrationEnabled: false,
      }),
    ).toBe(false);
  });

  it("defaults premium guests off unless explicitly enabled", () => {
    expect(isCmsGuestRegistrationAllowed({ visibility: "premium" })).toBe(false);
    expect(
      isCmsGuestRegistrationAllowed({
        visibility: "premium",
        guestRegistrationEnabled: true,
      }),
    ).toBe(true);
  });

  it("never allows private guests", () => {
    expect(
      isCmsGuestRegistrationAllowed({
        visibility: "private",
        guestRegistrationEnabled: true,
      }),
    ).toBe(false);
  });
});
