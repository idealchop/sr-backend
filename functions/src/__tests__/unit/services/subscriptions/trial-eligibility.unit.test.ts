import { describe, expect, it } from "vitest";
import {
  isTrialEligibleFromSubscriptionRows,
  subscriptionRowsIncludeTrial,
} from "../../../../services/subscriptions/trial-lifecycle-service";

describe("trial eligibility from subscription rows", () => {
  it("is eligible when no trial row exists", () => {
    const rows = [
      { data: { billingCycle: "monthly", planCode: "free" } },
    ];
    expect(subscriptionRowsIncludeTrial(rows)).toBe(false);
    expect(isTrialEligibleFromSubscriptionRows(rows)).toBe(true);
  });

  it("is not eligible when a trial record already exists", () => {
    const rows = [
      { data: { billingCycle: "monthly", planCode: "free", status: "active" } },
      { data: { billingCycle: "trial", planCode: "scale", status: "expired" } },
    ];
    expect(subscriptionRowsIncludeTrial(rows)).toBe(true);
    expect(isTrialEligibleFromSubscriptionRows(rows)).toBe(false);
  });

  it("treats superseded or expired trial rows as already used", () => {
    const rows = [
      { data: { billingCycle: "trial", status: "superseded" } },
    ];
    expect(isTrialEligibleFromSubscriptionRows(rows)).toBe(false);
  });
});
