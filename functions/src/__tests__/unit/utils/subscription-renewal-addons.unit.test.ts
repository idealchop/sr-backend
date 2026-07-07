import { describe, expect, it } from "vitest";
import {
  addonLineTotalForCycle,
  buildRenewalAddonCheckout,
} from "../../../utils/subscription-renewal-addons";
import { buildAddonCatalogLookup } from "../../../utils/subscription-addon-limit-boosts";

describe("subscription-renewal-addons", () => {
  const catalog = buildAddonCatalogLookup([
    {
      id: "addon_ext_rider",
      code: "EXT_RIDER",
      price: 500,
      billingInterval: "monthly",
      unit: 1,
      isActive: true,
    },
    {
      id: "addon_ai_boost",
      code: "AI_BOOST",
      price: 200,
      billingInterval: "monthly",
      unit: 1,
      isActive: true,
    },
  ]);

  it("rebuilds active add-on lines for monthly renewal", () => {
    const result = buildRenewalAddonCheckout(
      {
        addonLineItems: [
          { addonId: "addon_ext_rider", quantity: 2 },
          { addonId: "addon_ai_boost", quantity: 0 },
        ],
      },
      catalog,
      "monthly",
    );

    expect(result.addonLineItems).toEqual([
      {
        addonId: "addon_ext_rider",
        code: "EXT_RIDER",
        quantity: 2,
        lineTotal: 1000,
      },
    ]);
    expect(result.addonsTotal).toBe(1000);
  });

  it("annualizes monthly-priced add-ons on yearly renewal", () => {
    expect(addonLineTotalForCycle(
      {
        id: "addon_ext_rider",
        price: 500,
        billingInterval: "monthly",
        unit: 1,
      },
      1,
      "yearly",
    )).toBe(6000);
  });
});
