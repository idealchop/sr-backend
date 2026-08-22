import { describe, expect, it } from "vitest";
import {
  possessionRowDeductsStock,
  toStockedPossession,
} from "../../../../services/customers/customer-possession-stock";

describe("possessionRowDeductsStock", () => {
  it("uses the explicit per-row flag when set", () => {
    expect(possessionRowDeductsStock({ deductFromStock: true }, false)).toBe(true);
    expect(possessionRowDeductsStock({ deductFromStock: false }, true)).toBe(false);
  });

  it("falls back to customer WRS policy when the flag is missing", () => {
    expect(possessionRowDeductsStock({ quantity: 2 }, true)).toBe(true);
    expect(possessionRowDeductsStock({ quantity: 2 }, false)).toBe(false);
    expect(possessionRowDeductsStock(undefined, true)).toBe(true);
  });
});

describe("toStockedPossession", () => {
  it("keeps only deducting rows with quantity", () => {
    expect(
      toStockedPossession(
        {
          a: { itemName: "Round", quantity: 2, deductFromStock: true },
          b: { itemName: "Slim", quantity: 3, deductFromStock: false },
          c: { itemName: "Empty", quantity: 0, deductFromStock: true },
        },
        false,
      ),
    ).toEqual({
      a: { itemName: "Round", quantity: 2 },
    });
  });

  it("treats missing flags as the customer WRS fallback", () => {
    expect(
      toStockedPossession(
        { a: { itemName: "Round", quantity: 1 } },
        true,
      ),
    ).toEqual({ a: { itemName: "Round", quantity: 1 } });
    expect(
      toStockedPossession(
        { a: { itemName: "Round", quantity: 1 } },
        false,
      ),
    ).toEqual({});
  });
});
