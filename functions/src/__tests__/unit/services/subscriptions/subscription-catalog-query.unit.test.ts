import { describe, expect, it } from "vitest";
import { SUBSCRIPTION_PLAN_CATALOG_ROWS } from "../../../../config/subscription-plans-catalog";
import { featureBulletsFromPlan } from "../../../../services/subscriptions/subscription-catalog-query";
import { defaultCapabilitiesForPlanCode } from "../../../../utils/plan-capabilities";
import { parsePlanLimitations } from "../../../../utils/subscription-addon-plan-limits";

describe("featureBulletsFromPlan", () => {
  it("renders Free-style quotas and locate-only map", () => {
    const bullets = featureBulletsFromPlan({
      limitations: {
        customers: { max: 100 },
        containers: { frequency: "daily", max: 50 },
        online_orders: { frequency: "daily", max: 0 },
      },
      capabilities: { map: "locate_only" },
    });
    expect(bullets).toContain("100 Customers");
    expect(bullets).toContain("50 Containers / Day");
    expect(bullets).toContain("QR portal orders not included");
    expect(bullets).toContain("Interactive Map Limited");
  });

  it("shows 1 Rider App when the plan includes a rider seat", () => {
    const bullets = featureBulletsFromPlan({
      limitations: {
        customers: "full",
        containers: { frequency: "daily", max: 150 },
        online_orders: { frequency: "daily", max: 10 },
        staff: { admin: 0, rider: 1 },
      },
      capabilities: { map: "locate_only" },
    });
    expect(bullets).toContain("1 Rider App");
  });

  it("gives every catalog plan unlimited staff seats", () => {
    for (const code of ["free", "starter", "grow", "pro", "scale", "enterprise"]) {
      const row = SUBSCRIPTION_PLAN_CATALOG_ROWS[code];
      expect(row.limitations.staff).toEqual({ admin: "full", rider: "full" });
      const q = parsePlanLimitations(row.limitations);
      expect(q?.staffRiderMax).toBeNull();
      expect(q?.staffAdminMax).toBeNull();
    }
    expect(defaultCapabilitiesForPlanCode("starter").teamHub).toBe(true);
    expect(
      featureBulletsFromPlan({
        code: "starter",
        limitations: { staff: { admin: 0, rider: 0 } },
        capabilities: { map: "locate_only" },
      }),
    ).toContain("Unlimited Staff Apps");
  });
});
