import { describe, it, expect } from "vitest";
import {
  parsePlanSupportAccess,
  resolveEffectiveSupportAccess,
} from "../../../utils/subscription-addon-plan-limits";
import { SUBSCRIPTION_PLAN_LIMITATION_PATCHES } from "../../../config/subscription-plans-catalog";

describe("parsePlanSupportAccess", () => {
  it("reads agentChat from limitations.support object", () => {
    const grow = parsePlanSupportAccess(
      { support: SUBSCRIPTION_PLAN_LIMITATION_PATCHES.grow.support },
      "grow",
    );
    expect(grow).toEqual({ level: "chat", chatEnabled: true });

    const starter = parsePlanSupportAccess(
      { support: SUBSCRIPTION_PLAN_LIMITATION_PATCHES.starter.support },
      "starter",
    );
    expect(starter).toEqual({ level: "community", chatEnabled: false });
  });

  it("treats capped chat object without agentChat as community-only", () => {
    const parsed = parsePlanSupportAccess(
      {
        support: {
          chat: { max: 5, frequency: "monthly" },
          attachments: false,
          agentChat: false,
        },
      },
      "starter",
    );
    expect(parsed).toEqual({ level: "community", chatEnabled: false });
  });
});

describe("resolveEffectiveSupportAccess", () => {
  it("enables chat for paid Scale (monthly)", () => {
    const planSupport = parsePlanSupportAccess(null, "scale");
    const effective = resolveEffectiveSupportAccess({
      planSupport,
      planCode: "scale",
      billingCycle: "monthly",
      status: "active",
      isExpired: false,
    });
    expect(effective.chatEnabled).toBe(true);
    expect(effective.level).toBe("chat");
  });

  it("enables agent chat for Scale trial when plan support allows it", () => {
    const planSupport = parsePlanSupportAccess(
      { support: SUBSCRIPTION_PLAN_LIMITATION_PATCHES.scale.support },
      "scale",
    );
    const effective = resolveEffectiveSupportAccess({
      planSupport,
      planCode: "scale",
      billingCycle: "trial",
      status: "active",
      isExpired: false,
    });
    expect(effective.chatEnabled).toBe(true);
    expect(effective.level).toBe("chat");
  });

  it("enables agent chat for Grow trial when plan support allows it", () => {
    const planSupport = parsePlanSupportAccess(
      { support: SUBSCRIPTION_PLAN_LIMITATION_PATCHES.grow.support },
      "grow",
    );
    const effective = resolveEffectiveSupportAccess({
      planSupport,
      planCode: "grow",
      billingCycle: "trial",
      status: "active",
      isExpired: false,
    });
    expect(effective.chatEnabled).toBe(true);
    expect(effective.level).toBe("chat");
  });

  it("disables chat on Starter free mode", () => {
    const planSupport = parsePlanSupportAccess(null, "starter");
    const effective = resolveEffectiveSupportAccess({
      planSupport,
      planCode: "starter",
      billingCycle: "monthly",
      status: "active",
      isExpired: false,
    });
    expect(effective.chatEnabled).toBe(false);
  });

  it("enables chat for paid Scale in grace period", () => {
    const planSupport = parsePlanSupportAccess(null, "scale");
    const effective = resolveEffectiveSupportAccess({
      planSupport,
      planCode: "scale",
      billingCycle: "yearly",
      status: "grace_period",
      isExpired: false,
    });
    expect(effective.chatEnabled).toBe(true);
  });
});
