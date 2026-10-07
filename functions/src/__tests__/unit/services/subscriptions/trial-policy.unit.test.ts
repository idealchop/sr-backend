import { describe, expect, it } from "vitest";
import {
  applyTrialOverlayToLimitations,
  DEFAULT_TRIAL_POLICY,
  parseTrialPolicy,
} from "../../../../services/subscriptions/trial-policy";

describe("trial-policy", () => {
  it("defaults to a 15-day Scale trial with a 3-day team-chat preview", () => {
    const policy = parseTrialPolicy(null);
    expect(policy).toMatchObject({
      enabled: true,
      durationDays: 15,
      basedOnPlanCode: "scale",
      fallbackPlanCode: "free",
      teamChatPreviewDays: 3,
    });
    expect(policy.overlayLimitations).toEqual(DEFAULT_TRIAL_POLICY.overlayLimitations);
  });

  it("reads published policy fields", () => {
    const policy = parseTrialPolicy({
      durationDays: 10,
      basedOnPlanCode: "Grow",
      teamChatPreviewDays: 5,
      overlayLimitations: { support: { trial: { chat: { max: 2, frequency: "daily" } } } },
    });
    expect(policy.durationDays).toBe(10);
    expect(policy.basedOnPlanCode).toBe("grow");
    expect(policy.teamChatPreviewDays).toBe(5);
  });

  it("merges overlay limitations onto the base plan", () => {
    const merged = applyTrialOverlayToLimitations(
      { customers: "full", support: { chat: { max: 50, frequency: "daily" } } },
      { support: { trial: { chat: { max: 5, frequency: "daily" } } } },
    );
    expect(merged.customers).toBe("full");
    expect(merged.support).toEqual({
      chat: { max: 50, frequency: "daily" },
      trial: { chat: { max: 5, frequency: "daily" } },
    });
  });
});
