import { describe, expect, it } from "vitest";
import {
  applyAddonBoostsToQuotas,
  buildAddonCatalogLookup,
  extractAddonLineItems,
  resolveAddonLimitBoostsFromLines,
} from "../../../utils/subscription-addon-limit-boosts";
import { parsePlanLimitations } from "../../../utils/subscription-addon-plan-limits";

describe("subscription-addon-limit-boosts", () => {
  it("extracts addon lines from metadata or top-level field", () => {
    expect(
      extractAddonLineItems({
        metadata: {
          addonLineItems: [{ addonId: "addon_ext_rider", quantity: 2 }],
        },
      }),
    ).toHaveLength(1);

    expect(
      extractAddonLineItems({
        addonLineItems: [{ code: "EXT_RIDER", quantity: 1 }],
      }),
    ).toHaveLength(1);
  });

  it("adds rider and AI boosts into plan quotas", () => {
    const base = parsePlanLimitations({
      staff: { rider: 1, admin: 0 },
      aiTools: { max: 20 },
      transactions: { max: 100, frequency: "daily" },
    });
    const catalog = buildAddonCatalogLookup([
      {
        id: "addon_ext_rider",
        code: "EXT_RIDER",
        extendsPlanLimitation: "staff_rider",
        unit: 1,
      },
      {
        id: "addon_ai_boost",
        code: "EXT_AI_BOOST",
        featureKey: "ai_prompt_pack",
        extendsPlanLimitation: "ai_tools",
        unit: 1,
      },
    ]);

    const boosts = resolveAddonLimitBoostsFromLines(
      {
        metadata: {
          addonLineItems: [
            { addonId: "addon_ext_rider", quantity: 1 },
            { addonId: "addon_ai_boost", quantity: 1 },
          ],
        },
      },
      catalog,
    );

    const merged = applyAddonBoostsToQuotas(base, boosts);
    expect(merged?.staffRiderMax).toBe(2);
    expect(merged?.aiToolsMonthlyMax).toBe(520);
    expect(merged?.transactionsDailyMax).toBe(100);
  });
});
