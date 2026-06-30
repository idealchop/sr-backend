import { describe, expect, it } from "vitest";
import { resolveCommunityMessengerWrsPlanAccess } from "../../../utils/community-messenger-plan-access";

describe("community-messenger-plan-access", () => {
  it("allows Scale trial, paid Scale, Enterprise, and grace", () => {
    expect(
      resolveCommunityMessengerWrsPlanAccess({
        planCode: "scale",
        billingCycle: "trial",
        status: "active",
      }),
    ).toBe(true);
    expect(
      resolveCommunityMessengerWrsPlanAccess({
        planCode: "scale",
        billingCycle: "monthly",
        status: "active",
      }),
    ).toBe(true);
    expect(
      resolveCommunityMessengerWrsPlanAccess({
        planCode: "enterprise",
        billingCycle: "yearly",
        status: "grace_period",
      }),
    ).toBe(true);
  });

  it("blocks Grow, Starter, and expired Scale", () => {
    expect(
      resolveCommunityMessengerWrsPlanAccess({
        planCode: "grow",
        status: "active",
      }),
    ).toBe(false);
    expect(
      resolveCommunityMessengerWrsPlanAccess({
        planCode: "pro",
        status: "active",
      }),
    ).toBe(false);
    expect(
      resolveCommunityMessengerWrsPlanAccess({
        planCode: "starter",
        status: "active",
      }),
    ).toBe(false);
    expect(
      resolveCommunityMessengerWrsPlanAccess({
        planCode: "scale",
        status: "active",
        isExpired: true,
      }),
    ).toBe(false);
  });
});
