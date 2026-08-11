import { describe, expect, it } from "vitest";
import { InventoryService } from "../../../../services/inventory/inventory-service";

describe("InventoryService.matchesSearchQuery", () => {
  it("matches common catalog fields case-insensitively", () => {
    const item = {
      id: "sku-9",
      name: "Slim Gallon Shell",
      categoryId: "containers",
      category: "Containers",
      description: "Blue shell",
      stock: { current: 1, min: 0, unit: "pcs" },
      cost: 0,
    } as Parameters<typeof InventoryService.matchesSearchQuery>[0] & {
      category?: string;
      description?: string;
    };

    expect(InventoryService.matchesSearchQuery(item, "slim")).toBe(true);
    expect(InventoryService.matchesSearchQuery(item, "containers")).toBe(true);
    expect(InventoryService.matchesSearchQuery(item, "sku-9")).toBe(true);
    expect(InventoryService.matchesSearchQuery(item, "blue")).toBe(true);
    expect(InventoryService.matchesSearchQuery(item, "missing")).toBe(false);
  });
});
