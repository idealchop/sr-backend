import { describe, expect, it } from "vitest";
import type { DeliveryProduct } from "../../../../services/products/product-types";
import type { InventoryRoleRow } from "../../../../services/transactions/possession-from-order-lines";
import {
  assignmentEventsFromOrders,
  isContainerPossessionInventory,
  netPossessionFromOrders,
  orderAppliesContainerPossession,
  possessionDeliveryItemsFromOrder,
  possessionHasPositiveQuantity,
} from "../../../../services/transactions/possession-from-order-lines";

const slimProduct: DeliveryProduct = {
  id: "p-slim",
  name: "Slim Purified",
  unitPrice: 25,
  active: true,
  showInCustomerOrder: true,
  defaultForOrder: false,
  itemOnly: false,
  components: [],
};

const alkalineProduct: DeliveryProduct = {
  id: "p-alk",
  name: "Alkaline",
  unitPrice: 30,
  active: true,
  showInCustomerOrder: true,
  defaultForOrder: true,
  itemOnly: false,
  components: [],
};

const inventory: InventoryRoleRow[] = [
  { id: "inv-slim", name: "Slim", inventoryRole: "container_slim" },
  { id: "inv-round", name: "Round", inventoryRole: "container_round" },
  { id: "inv-shell", name: "WRS Shell", inventoryRole: "container_shell" },
  { id: "inv-cap", name: "Cap", inventoryRole: "kit_component" },
];

describe("possessionDeliveryItemsFromOrder", () => {
  it("uses container SKU lines when the ticket already has them", () => {
    const lines = possessionDeliveryItemsFromOrder(
      [{ inventoryId: "inv-shell", name: "WRS Shell", quantity: 3 }],
      [{ waterTypeId: "alkaline", name: "Alkaline", quantity: 5, unitPrice: 30, subtotal: 150 }],
      inventory,
      [alkalineProduct],
      "wrs_rotation",
    );
    expect(lines).toEqual([
      expect.objectContaining({ inventoryId: "inv-shell", quantity: 3 }),
    ]);
  });

  it("maps refill-only Slim gallons onto the Slim catalog item", () => {
    const lines = possessionDeliveryItemsFromOrder(
      [{ inventoryId: "inv-cap", name: "Cap", quantity: 2 }],
      [{
        waterTypeId: "slim_purified",
        productId: "p-slim",
        name: "Slim Purified",
        quantity: 2,
        unitPrice: 25,
        subtotal: 50,
      }],
      inventory,
      [slimProduct],
      "byog",
    );
    expect(lines).toEqual([
      expect.objectContaining({ inventoryId: "inv-slim", quantity: 2 }),
    ]);
  });

  it("maps unnamed refill gallons to WRS shells when rotation is the policy", () => {
    const lines = possessionDeliveryItemsFromOrder(
      [],
      [{ waterTypeId: "alkaline", name: "Alkaline", quantity: 4, unitPrice: 30, subtotal: 120 }],
      inventory,
      [alkalineProduct],
      "wrs_rotation",
    );
    expect(lines).toEqual([
      expect.objectContaining({ inventoryId: "inv-shell", quantity: 4 }),
    ]);
  });
});

describe("netPossessionFromOrders", () => {
  it("sums fulfilled refill deliveries and skips pending tickets", () => {
    const net = netPossessionFromOrders(
      [
        {
          type: "delivery",
          deliveryStatus: "completed",
          waterRefills: [{
            waterTypeId: "slim_purified",
            productId: "p-slim",
            name: "Slim Purified",
            quantity: 2,
            unitPrice: 25,
            subtotal: 50,
          }],
        },
        {
          type: "delivery",
          deliveryStatus: "pending",
          salesStockApplied: false,
          waterRefills: [{
            waterTypeId: "slim_purified",
            productId: "p-slim",
            name: "Slim Purified",
            quantity: 9,
            unitPrice: 25,
            subtotal: 225,
          }],
        },
      ],
      inventory,
      [slimProduct],
      "byog",
    );
    expect(net).toEqual({
      "inv-slim": { itemName: "Slim", quantity: 2 },
    });
  });

  it("emits one history row per fulfilled delivery", () => {
    const events = assignmentEventsFromOrders(
      [
        {
          id: "tx-1",
          type: "delivery",
          deliveryStatus: "completed",
          waterRefills: [{
            waterTypeId: "slim_purified",
            productId: "p-slim",
            name: "Slim Purified",
            quantity: 3,
            unitPrice: 25,
            subtotal: 75,
          }],
        },
        {
          id: "tx-2",
          type: "delivery",
          deliveryStatus: "completed",
          waterRefills: [{
            waterTypeId: "slim_purified",
            productId: "p-slim",
            name: "Slim Purified",
            quantity: 4,
            unitPrice: 25,
            subtotal: 100,
          }],
        },
      ],
      inventory,
      [slimProduct],
      "byog",
    );
    expect(events).toEqual([
      expect.objectContaining({
        transactionId: "tx-1",
        inventoryItemId: "inv-slim",
        quantityAssigned: 3,
        movement: "possess",
      }),
      expect.objectContaining({
        transactionId: "tx-2",
        inventoryItemId: "inv-slim",
        quantityAssigned: 4,
        movement: "possess",
      }),
    ]);
  });

  it("emits possess then return on the same ticket", () => {
    const events = assignmentEventsFromOrders(
      [
        {
          id: "tx-mix",
          type: "delivery",
          deliveryStatus: "completed",
          waterRefills: [{
            waterTypeId: "slim_purified",
            productId: "p-slim",
            name: "Slim Purified",
            quantity: 5,
            unitPrice: 25,
            subtotal: 125,
          }],
          collectionItems: [{
            inventoryId: "inv-slim",
            name: "Slim",
            qtyExpected: 3,
            qtyCollected: 3,
            qtyOk: 3,
            qtyDamaged: 0,
            qtyMissing: 0,
            deficitQty: 0,
            status: "ok",
          }],
        },
      ],
      inventory,
      [slimProduct],
      "byog",
    );
    expect(events).toEqual([
      expect.objectContaining({
        transactionId: "tx-mix",
        movement: "possess",
        quantityAssigned: 5,
      }),
      expect.objectContaining({
        transactionId: "tx-mix",
        movement: "return",
        quantityAssigned: -3,
      }),
    ]);
  });
});

describe("orderAppliesContainerPossession", () => {
  it("counts completed deliveries and ignores cancelled ones", () => {
    expect(orderAppliesContainerPossession({
      type: "delivery",
      deliveryStatus: "completed",
    })).toBe(true);
    expect(orderAppliesContainerPossession({
      type: "delivery",
      deliveryStatus: "cancelled",
    })).toBe(false);
    expect(orderAppliesContainerPossession({
      type: "delivery",
      deliveryStatus: "pending",
      salesStockApplied: false,
    })).toBe(false);
  });
});

describe("possessionHasPositiveQuantity", () => {
  it("treats zero-qty seed rows as empty", () => {
    expect(possessionHasPositiveQuantity({ slim: { quantity: 0 } })).toBe(false);
    expect(possessionHasPositiveQuantity({ slim: { quantity: 2 } })).toBe(true);
  });
});

describe("isContainerPossessionInventory", () => {
  it("accepts shell and owned shape roles", () => {
    expect(isContainerPossessionInventory("Slim", "container_slim")).toBe(true);
    expect(isContainerPossessionInventory("Payatot", "general")).toBe(false);
  });
});
