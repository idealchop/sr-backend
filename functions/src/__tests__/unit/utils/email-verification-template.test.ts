import { describe, it, expect } from "vitest";
import { getEmailVerificationEmail } from "../../../utils/auth-transactional-email";

describe("getEmailVerificationEmail", () => {
  const link = "https://smartrefill.io/verified?oobCode=abc&mode=verifyEmail";

  it("renders owner verification with premium layout sections", () => {
    const tpl = getEmailVerificationEmail({
      displayName: "Maria Santos",
      email: "owner@station.ph",
      verificationLink: link,
      audience: "owner",
    });

    expect(tpl.subject).toContain("station account");
    expect(tpl.html).toContain("Maria Santos");
    expect(tpl.html).toContain("oobCode=abc");
    expect(tpl.text).toContain(link);
    expect(tpl.html).toContain("What happens next");
    expect(tpl.html).toContain("Station owner");
    expect(tpl.html).toContain("Confirm email address");
    expect(tpl.text).toContain("owner@station.ph");
    expect(tpl.brevoTag).toBe("email_verification");
  });

  it("renders staff verification via dedicated staff template", () => {
    const tpl = getEmailVerificationEmail({
      displayName: "Juan Rider",
      email: "rider@station.ph",
      verificationLink: link,
      audience: "staff",
      workspaceName: "River Station",
      memberRole: "admin",
    });

    expect(tpl.subject).toContain("River Station");
    expect(tpl.html).toContain("Confirm your workspace email");
    expect(tpl.html).toContain("Administrator");
    expect(tpl.html).toContain("staff onboarding");
    expect(tpl.brevoTag).toBe("email_verification_staff");
  });
});
