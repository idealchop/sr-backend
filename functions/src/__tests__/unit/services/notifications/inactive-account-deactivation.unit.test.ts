import { describe, expect, it } from "vitest";
import {
  isWorkspaceInactivityDeactivated,
  shouldDeactivateForInactivity,
  unusedDaysBetween,
} from "../../../../utils/inactive-account-deactivation-policy";
import { buildInactiveAccountDeactivationEmail } from "../../../../utils/inactive-account-deactivation-email-template";

describe("inactive account deactivation", () => {
  const now = new Date("2026-09-20T00:00:00.000Z");

  it("counts unused days from last activity", () => {
    expect(
      unusedDaysBetween(new Date("2026-08-20T00:00:00.000Z"), now),
    ).toBe(31);
  });

  it("deactivates after 30 days without use", () => {
    expect(
      shouldDeactivateForInactivity({
        lastActivityAt: new Date("2026-08-20T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        alreadyDeactivated: false,
        now,
      }),
    ).toBe(true);
  });

  it("keeps recently used workspaces", () => {
    expect(
      shouldDeactivateForInactivity({
        lastActivityAt: new Date("2026-09-10T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        alreadyDeactivated: false,
        now,
      }),
    ).toBe(false);
  });

  it("uses createdAt when there is no login activity", () => {
    expect(
      shouldDeactivateForInactivity({
        lastActivityAt: null,
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        alreadyDeactivated: false,
        now,
      }),
    ).toBe(true);
  });

  it("skips already deactivated workspaces", () => {
    expect(
      shouldDeactivateForInactivity({
        lastActivityAt: new Date("2026-01-01T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        alreadyDeactivated: true,
        now,
      }),
    ).toBe(false);
  });

  it("treats a timestamp field as deactivated", () => {
    expect(
      isWorkspaceInactivityDeactivated({
        inactivityDeactivatedAt: "2026-09-20T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(isWorkspaceInactivityDeactivated({})).toBe(false);
  });

  it("builds an Atlassian-style deactivation email without riverph.com", () => {
    const tpl = buildInactiveAccountDeactivationEmail({
      ownerName: "Jimboy",
      businessName: "Smart Refill Demo",
      loginUrl: "https://app.smartrefill.io/login",
    });
    expect(tpl.subject).toContain("deactivated due to inactivity");
    expect(tpl.html).toContain("Smart Refill Demo");
    expect(tpl.html).toContain("Sign in to keep this workspace");
    expect(tpl.html).toContain("Privacy Policy");
    expect(tpl.html).toContain("Join community group");
    expect(tpl.html).not.toContain("riverph.com");
    expect(tpl.brevoTag).toBe("inactive_account_deactivation_email");
  });
});
