import { describe, expect, it } from "vitest";
import {
  isStockTrackedInventoryId,
  resolveStockInventoryLineId,
  transactionSkipsSalesInventoryStock,
  walkInHasStockSaleItems,
} from "../../../../services/transactions/transaction-line-inventory";

describe("transaction-line-inventory", () => {
  it("treats manual_item and adjustment as non-stock lines", () => {
    expect(isStockTrackedInventoryId("manual_item")).toBe(false);
    expect(isStockTrackedInventoryId("adjustment")).toBe(false);
    expect(isStockTrackedInventoryId("inv-abc")).toBe(true);
  });

  it("resolveStockInventoryLineId prefers real ids only", () => {
    expect(
      resolveStockInventoryLineId({
        inventoryId: "manual_item",
        itemId: "fallback",
      }),
    ).toBeUndefined();
    expect(
      resolveStockInventoryLineId({
        inventoryId: "adjustment",
      }),
    ).toBeUndefined();
    expect(
      resolveStockInventoryLineId({
        inventoryId: "item-123",
      }),
    ).toBe("item-123");
    expect(
      resolveStockInventoryLineId({
        itemId: "item-456",
      }),
    ).toBe("item-456");
  });

  it("marks walk-in refills as ledger-only unless priced inventory lines exist", () => {
    expect(transactionSkipsSalesInventoryStock("walkin")).toBe(true);
    expect(
      transactionSkipsSalesInventoryStock("walkin", [
        { inventoryId: "jug-round", quantity: 1, unitPrice: 350, subtotal: 350 },
      ]),
    ).toBe(false);
    expect(walkInHasStockSaleItems([{ inventoryId: "jug-round", unitPrice: 350 }])).toBe(
      true,
    );
    expect(transactionSkipsSalesInventoryStock("direct_sale")).toBe(false);
    expect(transactionSkipsSalesInventoryStock("expense")).toBe(true);
  });
});
