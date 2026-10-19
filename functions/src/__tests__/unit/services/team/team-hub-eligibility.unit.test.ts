import { describe, expect, it } from "vitest";
import { teamHubInviteDeniedReason } from "../../../../services/team/team-hub-eligibility";

describe("teamHubInviteDeniedReason", () => {
  it("blocks Free", () => {
    expect(
      teamHubInviteDeniedReason({
        planCode: "free",
        billingCycle: "monthly",
        status: "active",
      }),
    ).toMatch(/Free plan/i);
  });

  it("allows Scale trial rider and staff invites for the trial window", () => {
    expect(
      teamHubInviteDeniedReason({
        planCode: "scale",
        billingCycle: "trial",
        status: "active",
      }),
    ).toBeNull();
    expect(
      teamHubInviteDeniedReason({
        planCode: "scale",
        billingCycle: "trial",
        status: "trial",
      }),
    ).toBeNull();
  });

  it("allows paid Starter rider invites and Scale staff seats", () => {
    expect(
      teamHubInviteDeniedReason({
        planCode: "starter",
        billingCycle: "monthly",
        status: "active",
      }),
    ).toBeNull();
    expect(
      teamHubInviteDeniedReason({
        planCode: "scale",
        billingCycle: "monthly",
        status: "grace_period",
      }),
    ).toBeNull();
  });

  it("blocks expired rows, including an ended trial", () => {
    expect(
      teamHubInviteDeniedReason({
        planCode: "scale",
        billingCycle: "monthly",
        status: "expired",
      }),
    ).toMatch(/active subscription/i);
    expect(
      teamHubInviteDeniedReason({
        planCode: "scale",
        billingCycle: "trial",
        status: "expired",
      }),
    ).toMatch(/active subscription/i);
  });
});
