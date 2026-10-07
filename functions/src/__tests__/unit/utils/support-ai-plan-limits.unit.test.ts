import { describe, expect, it } from "vitest";
import {
  parsePlanSupportAiLimits,
  resolveSupportAiPlanLimits,
} from "../../../utils/support-ai-plan-limits";
import { SUBSCRIPTION_PLAN_LIMITATION_PATCHES } from "../../../config/subscription-plans-catalog";

describe("resolveSupportAiPlanLimits", () => {
  it("turns Buddy off on Free, Starter, and Grow", () => {
    for (const planCode of ["free", "starter", "grow"] as const) {
      const limits = resolveSupportAiPlanLimits({
        planCode,
        billingCycle: "monthly",
        status: "active",
        isExpired: false,
        agentChatEnabled: true,
      });
      expect(limits.chatMax).toBe(0);
      expect(limits.attachmentsAllowed).toBe(false);
      expect(limits.agentChatEnabled).toBe(true);
    }
  });

  it("gives Scale trial 5 Buddy prompts per day", () => {
    const limits = resolveSupportAiPlanLimits({
      planCode: "scale",
      billingCycle: "trial",
      status: "active",
      isExpired: false,
      agentChatEnabled: true,
    });
    expect(limits).toEqual({
      chatMax: 5,
      chatFrequency: "daily",
      attachmentsMax: 5,
      attachmentsAllowed: true,
      agentChatEnabled: true,
    });
  });

  it("gives paid Scale unlimited River AI Buddy", () => {
    const limits = resolveSupportAiPlanLimits({
      planCode: "scale",
      billingCycle: "monthly",
      status: "active",
      isExpired: false,
      agentChatEnabled: true,
    });
    expect(limits.chatMax).toBeNull();
    expect(limits.attachmentsAllowed).toBe(true);
    expect(limits.agentChatEnabled).toBe(true);
  });
});

describe("parsePlanSupportAiLimits + catalog", () => {
  it("reads Starter support as human chat only from catalog", () => {
    const parsed = parsePlanSupportAiLimits(
      { support: SUBSCRIPTION_PLAN_LIMITATION_PATCHES.starter.support },
      { planCode: "starter", billingCycle: "monthly", status: "active" },
    );
    expect(parsed).toMatchObject({
      chatMax: 0,
      attachmentsAllowed: false,
      agentChatEnabled: true,
    });
  });

  it("uses support.trial on Scale trial billing", () => {
    const limits = resolveSupportAiPlanLimits({
      planCode: "scale",
      billingCycle: "trial",
      status: "active",
      isExpired: false,
      agentChatEnabled: true,
      limitations: { support: SUBSCRIPTION_PLAN_LIMITATION_PATCHES.scale.support },
    });
    expect(limits).toMatchObject({
      chatMax: 5,
      chatFrequency: "daily",
      attachmentsAllowed: true,
      agentChatEnabled: true,
    });
  });

  it("reads Grow catalog as human chat without Buddy", () => {
    const limits = resolveSupportAiPlanLimits({
      planCode: "grow",
      billingCycle: "monthly",
      status: "active",
      isExpired: false,
      agentChatEnabled: true,
      limitations: SUBSCRIPTION_PLAN_LIMITATION_PATCHES.grow,
    });
    expect(limits).toMatchObject({
      chatMax: 0,
      attachmentsAllowed: false,
      agentChatEnabled: true,
    });
  });
});
