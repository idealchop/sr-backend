import { describe, expect, it } from "vitest";
import { POST_ONBOARDING_QUICK_ACTIONS_UI_CONFIG } from "../../../../services/business/business-onboarding-defaults";

describe("business onboarding defaults", () => {
  it("starts Quick actions after Finish setup and clears a leftover Done flag", () => {
    expect(POST_ONBOARDING_QUICK_ACTIONS_UI_CONFIG).toEqual({
      postOnboardingQuickActionsPending: true,
      postOnboardingQuickActionsDone: false,
    });
  });
});
