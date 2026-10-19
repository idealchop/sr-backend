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

  it("gives Starter 1 rider app seat and Team Hub for that rider", () => {
    const starter = SUBSCRIPTION_PLAN_CATALOG_ROWS.starter;
    expect(starter.limitations.staff).toEqual({ admin: 0, rider: 1 });
    expect(parsePlanLimitations(starter.limitations)?.staffRiderMax).toBe(1);
    expect(defaultCapabilitiesForPlanCode("starter").teamHub).toBe(true);
    expect(defaultCapabilitiesForPlanCode("starter").teamHubAdmins).toBe(false);
    expect(
      featureBulletsFromPlan({
        limitations: starter.limitations,
        capabilities: defaultCapabilitiesForPlanCode("starter"),
      }),
    ).toContain("1 Rider App");
  });
});
