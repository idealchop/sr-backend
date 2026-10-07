import { describe, expect, it } from "vitest";
import { featureBulletsFromPlan } from "../../../../services/subscriptions/subscription-catalog-query";

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
});
