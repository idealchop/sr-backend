import { describe, expect, it } from "vitest";
import { buildTutorialPublishedOwnerEmail } from "../../../utils/tutorial-published-owner-email-template";

describe("buildTutorialPublishedOwnerEmail", () => {
  it("builds subject, html, and watch CTA", () => {
    const tpl = buildTutorialPublishedOwnerEmail({
      ownerName: "Ana",
      businessName: "River Station",
      tutorialName: "How to add a delivery",
      watchUrl: "https://app.smartrefill.io/dashboard?tutorial=vid-1",
    });

    expect(tpl.subject).toBe("New tutorial: How to add a delivery");
    expect(tpl.brevoTag).toBe("tutorial_published_owner_email");
    expect(tpl.html).toContain("How to add a delivery");
    expect(tpl.html).toContain("Watch tutorial");
    expect(tpl.html).toContain(
      "https://app.smartrefill.io/dashboard?tutorial=vid-1",
    );
    expect(tpl.text).toContain("Watch: https://app.smartrefill.io/dashboard?tutorial=vid-1");
  });
});
