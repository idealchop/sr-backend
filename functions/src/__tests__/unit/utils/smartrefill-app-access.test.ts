import { describe, it, expect } from "vitest";
import {
  buildSmartrefillOwnerAccessEntry,
  hasSmartrefillAppAccess,
  markSmartrefillOnboardingComplete,
} from "../../../utils/smartrefill-app-access";

describe("smartrefill-app-access", () => {
  it("detects smartrefill in appAccess", () => {
    expect(
      hasSmartrefillAppAccess([
        { appId: "other-app", role: "user" },
        { appId: "smartrefill", role: "owner" },
      ]),
    ).toBe(true);
  });

  it("returns false when smartrefill is absent", () => {
    expect(hasSmartrefillAppAccess([{ appId: "other-app" }])).toBe(false);
    expect(hasSmartrefillAppAccess(null)).toBe(false);
    expect(hasSmartrefillAppAccess(undefined)).toBe(false);
  });

  it("builds owner access entry", () => {
    expect(buildSmartrefillOwnerAccessEntry()).toEqual({
      appId: "smartrefill",
      role: "owner",
      onboardingComplete: false,
    });
  });

  it("marks smartrefill onboarding complete with business id", () => {
    const next = markSmartrefillOnboardingComplete(
      [{ appId: "smartrefill", role: "owner", onboardingComplete: false }],
      "biz-99",
    );
    expect(next).toEqual([
      {
        appId: "smartrefill",
        role: "owner",
        onboardingComplete: true,
        businessId: "biz-99",
      },
    ]);
  });

  it("adds smartrefill access when missing", () => {
    const next = markSmartrefillOnboardingComplete([], "biz-1");
    expect(next[0]).toMatchObject({
      appId: "smartrefill",
      onboardingComplete: true,
      businessId: "biz-1",
    });
  });
});
