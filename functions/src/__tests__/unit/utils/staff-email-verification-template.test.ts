import { describe, it, expect } from "vitest";
import { getStaffEmailVerificationEmail } from "../../../utils/staff-email-verification-template";

describe("getStaffEmailVerificationEmail", () => {
  const link = "https://smartrefill.io/staff-verified?oobCode=abc&mode=verifyEmail";

  it("renders professional staff layout with workspace and role", () => {
    const tpl = getStaffEmailVerificationEmail({
      displayName: "Juan Rider",
      email: "rider@station.ph",
      verificationLink: link,
      workspaceName: "Alphamart Water Station",
      memberRole: "rider",
    });

    expect(tpl.subject).toContain("Alphamart Water Station");
    expect(tpl.html).toContain("Confirm your workspace email");
    expect(tpl.html).toContain("Team workspace · Email verification");
    expect(tpl.html).toContain("Alphamart Water Station");
    expect(tpl.html).toContain("Rider / Operator");
    expect(tpl.html).toContain("What happens next");
    expect(tpl.html).toContain("DISCLAIMER");
    expect(tpl.text).toContain(link);
    expect(tpl.brevoTag).toBe("email_verification_staff");
  });

  it("falls back when workspace context is missing", () => {
    const tpl = getStaffEmailVerificationEmail({
      displayName: "Team User",
      email: "staff@example.com",
      verificationLink: link,
    });

    expect(tpl.html).toContain("Your Smart Refill workspace");
    expect(tpl.html).toContain("Team member");
  });
});
