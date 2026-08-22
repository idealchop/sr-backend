import { describe, expect, it } from "vitest";
import {
  derivedWaterTypesFromProducts,
  findProductForRefillLine,
  inferProductIconIdFromName,
  listCustomerOrderProducts,
  mergeBomInventoryLines,
  otherDefaultProductIds,
  parseProductWrite,
  ProductValidationError,
  resolveDeliveryCatalog,
  seedProductsFromWaterTypes,
  slugifyProductKey,
  virtualProductsFromWaterTypes,
} from "../../../../services/products/product-catalog";

describe("product catalog helpers", () => {
  it("seeds products from mixed waterTypes shapes", () => {
    const seeded = seedProductsFromWaterTypes([
      "Purified",
      { name: "Alkaline", price: 35 },
      { water: "Mineral", price: 30 },
    ]);
    expect(seeded.map((row) => row.name)).toEqual(["Purified", "Alkaline", "Mineral"]);
    expect(seeded[1].unitPrice).toBe(35);
    expect(seeded[0].legacyWaterName).toBe("Purified");
    expect(seeded[0].components).toEqual([]);
  });

  it("infers Round and Slim gallon icons from water type names", () => {
    expect(inferProductIconIdFromName("Round Purified")).toBe("round-gallon");
    expect(inferProductIconIdFromName("Slim Alkaline")).toBe("slim-gallon");
    expect(inferProductIconIdFromName("Mineral")).toBe("round-gallon");
    expect(inferProductIconIdFromName("Background water")).toBe("round-gallon");

    const seeded = seedProductsFromWaterTypes([
      { name: "Round Purified", price: 25 },
      { name: "Slim Purified", price: 25 },
      { name: "Mineral", price: 30, iconId: "package" },
    ]);
    expect(seeded.map((row) => row.iconId)).toEqual([
      "round-gallon",
      "slim-gallon",
      "package",
    ]);
  });

  it("derives waterTypes from active products only", () => {
    const derived = derivedWaterTypesFromProducts([
      { active: true, name: "Alkaline Round", legacyWaterName: "Alkaline", unitPrice: 35, sortOrder: 1 },
      { active: false, name: "Hidden", unitPrice: 10, sortOrder: 0 },
      { active: true, itemOnly: true, name: "Caps", unitPrice: 5, sortOrder: 2 },
    ]);
    expect(derived).toEqual([{ water: "Alkaline", price: 35 }]);
  });

  it("falls back to virtual products when the catalog is empty", () => {
    const catalog = resolveDeliveryCatalog([], [{ water: "Purified", price: 25 }]);
    expect(catalog).toHaveLength(1);
    expect(catalog[0].id.startsWith("virtual:")).toBe(true);
    expect(virtualProductsFromWaterTypes([{ water: "Purified", price: 25 }])[0].name).toBe(
      "Purified",
    );
  });

  it("parses itemOnly and defaults missing component quantity to 1", () => {
    const parsed = parseProductWrite(
      {
        name: "Caps",
        unitPrice: 5,
        itemOnly: true,
        components: [{ inventoryItemId: "inv1" }],
      },
      { requireName: true },
    );
    expect(parsed.itemOnly).toBe(true);
    expect(parsed.components).toEqual([{ inventoryItemId: "inv1", quantity: 1 }]);
  });

  it("rejects empty names and negative prices", () => {
    expect(() => parseProductWrite({ name: "  " }, { requireName: true })).toThrow(
      ProductValidationError,
    );
    expect(() =>
      parseProductWrite({ name: "Ok", unitPrice: -1 }, { requireName: true }),
    ).toThrow(/price/);
  });

  it("matches refill lines by productId or water name", () => {
    const products = [
      {
        id: "p1",
        name: "Alkaline Round",
        unitPrice: 35,
        active: true,
        showInCustomerOrder: true,
        components: [],
        legacyWaterName: "Alkaline",
      },
    ];
    expect(findProductForRefillLine(products, { productId: "p1" })?.name).toBe("Alkaline Round");
    expect(findProductForRefillLine(products, { type: "Alkaline" })?.id).toBe("p1");
    expect(findProductForRefillLine(products, { type: "alkaline_refill" })?.id).toBe("p1");
    expect(slugifyProductKey("Alkaline Refill")).toBe("alkaline");
  });

  it("merges BOM components into inventory lines without double-charging", () => {
    const products = [
      {
        id: "combo",
        name: "Starter kit",
        unitPrice: 450,
        active: true,
        showInCustomerOrder: true,
        components: [
          { inventoryItemId: "cap", quantity: 1 },
          { inventoryItemId: "faucet", quantity: 1 },
        ],
      },
    ];
    const merged = mergeBomInventoryLines(
      [{ inventoryId: "cap", name: "Cap", quantity: 1, unitPrice: 0, subtotal: 0 }],
      products,
      [{ productId: "combo", qty: 2 }],
      { cap: "Cap", faucet: "Faucet" },
    );
    expect(merged.find((row) => row.inventoryId === "cap")?.quantity).toBe(3);
    expect(merged.find((row) => row.inventoryId === "faucet")?.quantity).toBe(2);
    expect(merged.find((row) => row.inventoryId === "faucet")?.unitPrice).toBe(0);
  });

  it("filters customer-order products to active QR-visible rows", () => {
    const visible = listCustomerOrderProducts([
      { active: true, showInCustomerOrder: true },
      { active: false, showInCustomerOrder: true },
      { active: true, showInCustomerOrder: false },
    ]);
    expect(visible).toHaveLength(1);
  });

  it("parses defaultForOrder and lists other default ids", () => {
    expect(parseProductWrite({ defaultForOrder: true }).defaultForOrder).toBe(true);
    expect(parseProductWrite({ defaultForOrder: false }).defaultForOrder).toBe(false);
    expect(
      otherDefaultProductIds(
        [
          { id: "a", defaultForOrder: true },
          { id: "b", defaultForOrder: true },
          { id: "c", defaultForOrder: false },
        ],
        "b",
      ),
    ).toEqual(["a"]);
  });
});
