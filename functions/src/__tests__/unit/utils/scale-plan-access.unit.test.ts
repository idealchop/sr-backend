import { describe, expect, it } from "vitest";
import {
  isScalePlanCode,
  resolveScalePlatformAccess,
} from "../../../utils/scale-plan-access";

describe("scale-plan-access", () => {
  it("recognizes scale and enterprise plan codes", () => {
    expect(isScalePlanCode("scale")).toBe(true);
    expect(isScalePlanCode("enterprise")).toBe(true);
    expect(isScalePlanCode("grow")).toBe(false);
    expect(isScalePlanCode("starter")).toBe(false);
  });

  it("allows Scale trial", () => {
    expect(
      resolveScalePlatformAccess({
        planCode: "scale",
        billingCycle: "trial",
        status: "active",
      }),
    ).toBe(true);
  });

  it("allows paid Scale active and grace", () => {
    expect(
      resolveScalePlatformAccess({
        planCode: "scale",
        billingCycle: "monthly",
        status: "active",
      }),
    ).toBe(true);
    expect(
      resolveScalePlatformAccess({
        planCode: "scale",
        billingCycle: "yearly",
        status: "grace_period",
      }),
    ).toBe(true);
  });

  it("blocks Grow and Starter", () => {
    expect(
      resolveScalePlatformAccess({
        planCode: "grow",
        status: "active",
      }),
    ).toBe(false);
    expect(
      resolveScalePlatformAccess({
        planCode: "starter",
        status: "active",
      }),
    ).toBe(false);
  });

  it("blocks expired Scale", () => {
    expect(
      resolveScalePlatformAccess({
        planCode: "scale",
        status: "active",
        isExpired: true,
      }),
    ).toBe(false);
  });
});
