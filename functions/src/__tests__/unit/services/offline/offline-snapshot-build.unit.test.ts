import { beforeEach, describe, expect, it, vi } from "vitest";

const { customersMock, inventoryMock, txMock } = vi.hoisted(() => ({
  customersMock: vi.fn(),
  inventoryMock: vi.fn(),
  txMock: vi.fn(),
}));

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: vi.fn(async () => ({ exists: true, data: () => ({ name: "Aqua" }) })),
      })),
    })),
  },
}));
vi.mock("../../../../services/customers/customer-service", () => ({
  CustomerService: { getCustomersByBusiness: customersMock },
}));
vi.mock("../../../../services/inventory/inventory-service", () => ({
  InventoryService: { listItems: inventoryMock },
}));
vi.mock("../../../../services/transactions/transaction-service", () => ({
  TransactionService: { getTransactionsByBusiness: txMock },
}));

import {
  buildOfflineSnapshot,
  CUSTOMER_LIMIT,
  INVENTORY_LIMIT,
} from "../../../../services/offline/offline-snapshot-service";

describe("buildOfflineSnapshot read caps", () => {
  beforeEach(() => {
    customersMock.mockReset().mockResolvedValue([]);
    inventoryMock.mockReset().mockResolvedValue([]);
    txMock.mockReset().mockResolvedValue([]);
  });

  it("caps customers (400) and inventory (120) at the query", async () => {
    const snap = await buildOfflineSnapshot("biz-1", new Date("2026-11-09T04:00:00Z"));
    expect(CUSTOMER_LIMIT).toBe(400);
    expect(INVENTORY_LIMIT).toBe(120);
    expect(customersMock).toHaveBeenCalledWith("biz-1", { limit: 400 });
    expect(inventoryMock).toHaveBeenCalledWith("biz-1", { scanLimit: 120 });
    for (const call of txMock.mock.calls) {
      expect(call[1].limit).toBeGreaterThan(0);
    }
    expect(snap.businessName).toBe("Aqua");
  });
});
