import { describe, expect, it } from "vitest";
import { readExtraBusinessAddonSlots } from "../../../utils/extra-business-addon-access";

describe("extra-business-addon-access", () => {
  it("reads purchased extra business slots from status limitations", () => {
    expect(readExtraBusinessAddonSlots(null)).toBe(0);
    expect(
      readExtraBusinessAddonSlots({
        limitations: { addonBoosts: { extraBusiness: 2 } },
      }),
    ).toBe(2);
    expect(
      readExtraBusinessAddonSlots({
        limitations: { addonBoosts: { extraBusiness: 0 } },
      }),
    ).toBe(0);
  });
});
