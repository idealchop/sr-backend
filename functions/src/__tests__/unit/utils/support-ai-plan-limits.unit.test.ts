import { describe, expect, it } from "vitest";
import {
  parsePlanSupportAiLimits,
  resolveSupportAiPlanLimits,
} from "../../../utils/support-ai-plan-limits";
import { SUBSCRIPTION_PLAN_LIMITATION_PATCHES } from "../../../config/subscription-plans-catalog";

describe("resolveSupportAiPlanLimits", () => {
  it("limits Starter to 5 monthly chats without attachments or agent", () => {
    const limits = resolveSupportAiPlanLimits({
      planCode: "starter",
      billingCycle: "monthly",
      status: "active",
      isExpired: false,
      agentChatEnabled: false,
    });
    expect(limits).toEqual({
      chatMax: 5,
      chatFrequency: "monthly",
      attachmentsMax: null,
      attachmentsAllowed: false,
      agentChatEnabled: false,
    });
  });

  it("gives Scale trial 50 daily chats and attachments with agent chat", () => {
    const limits = resolveSupportAiPlanLimits({
      planCode: "scale",
      billingCycle: "trial",
      status: "active",
      isExpired: false,
      agentChatEnabled: true,
    });
    expect(limits).toEqual({
      chatMax: 50,
      chatFrequency: "daily",
      attachmentsMax: 50,
      attachmentsAllowed: true,
      agentChatEnabled: true,
    });
  });

  it("limits Grow to 10 monthly chats with attachments", () => {
    const limits = resolveSupportAiPlanLimits({
      planCode: "grow",
      billingCycle: "monthly",
      status: "active",
      isExpired: false,
      agentChatEnabled: true,
    });
    expect(limits).toEqual({
      chatMax: 10,
      chatFrequency: "monthly",
      attachmentsMax: null,
      attachmentsAllowed: true,
      agentChatEnabled: true,
    });
  });

  it("gives paid Scale unlimited River AI support", () => {
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
  it("reads Starter support limits from subscription_plans limitations", () => {
    const parsed = parsePlanSupportAiLimits(
      { support: SUBSCRIPTION_PLAN_LIMITATION_PATCHES.starter.support },
      { planCode: "starter", billingCycle: "monthly", status: "active" },
    );
    expect(parsed).toMatchObject({
      chatMax: 5,
      chatFrequency: "monthly",
      attachmentsAllowed: false,
      agentChatEnabled: false,
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
      chatMax: 50,
      chatFrequency: "daily",
      attachmentsMax: 50,
      attachmentsAllowed: true,
      agentChatEnabled: true,
    });
  });

  it("reads Grow chat cap from Firestore support limitations", () => {
    const limits = resolveSupportAiPlanLimits({
      planCode: "grow",
      billingCycle: "monthly",
      status: "active",
      isExpired: false,
      agentChatEnabled: true,
      limitations: SUBSCRIPTION_PLAN_LIMITATION_PATCHES.grow,
    });
    expect(limits).toMatchObject({
      chatMax: 10,
      chatFrequency: "monthly",
      attachmentsAllowed: true,
      agentChatEnabled: true,
    });
  });
});
