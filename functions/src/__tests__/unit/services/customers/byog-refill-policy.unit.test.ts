import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../config/firebase-admin", () => ({
  db: {
    collection: vi.fn(),
  },
}));

vi.mock("../../../../services/customers/customer-service", () => ({
  CustomerService: {
    getCustomer: vi.fn(),
    updateCustomer: vi.fn(),
  },
}));

import { db } from "../../../../config/firebase-admin";
import { CustomerService } from "../../../../services/customers/customer-service";
import { reconcileByogRefillPolicyIfNeeded } from "../../../../services/customers/byog-refill-policy";

describe("reconcileByogRefillPolicyIfNeeded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upgrades BYOG to WRS when refill qty exceeds owned containers", async () => {
    vi.mocked(CustomerService.getCustomer).mockResolvedValue({
      containerPolicy: "byog",
      possession: {
        g1: { itemName: "5 Gallon Slim", quantity: 5 },
      },
    } as never);

    const inventoryGet = vi.fn().mockResolvedValue({
      docs: [{ id: "g1", data: () => ({ name: "5 Gallon Slim" }) }],
    });
    const businessDoc = { collection: vi.fn().mockReturnValue({ get: inventoryGet }) };
    vi.mocked(db.collection).mockImplementation(((name: string) => {
      if (name === "businesses") {
        return {
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ containerDefaultPolicy: "wrs_rotation" }),
            }),
            collection: businessDoc.collection,
          }),
        };
      }
      return { doc: vi.fn() };
    }) as never);

    vi.mocked(CustomerService.updateCustomer).mockResolvedValue(undefined as never);

    const result = await reconcileByogRefillPolicyIfNeeded("biz1", "cust1", [
      { qty: 10 },
    ]);

    expect(result.upgraded).toBe(true);
    expect(result.effectivePolicy).toBe("wrs_rotation");
    expect(CustomerService.updateCustomer).toHaveBeenCalledWith("biz1", "cust1", {
      containerPolicy: "wrs_rotation",
      possession: {},
    });
  });

  it("keeps BYOG when refill qty fits declared containers", async () => {
    vi.mocked(CustomerService.getCustomer).mockResolvedValue({
      containerPolicy: "byog",
      possession: {
        g1: { itemName: "5 Gallon Slim", quantity: 10 },
      },
    } as never);

    const inventoryGet = vi.fn().mockResolvedValue({
      docs: [{ id: "g1", data: () => ({ name: "5 Gallon Slim" }) }],
    });
    const businessDoc = { collection: vi.fn().mockReturnValue({ get: inventoryGet }) };
    vi.mocked(db.collection).mockImplementation(((name: string) => {
      if (name === "businesses") {
        return {
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ containerDefaultPolicy: "wrs_rotation" }),
            }),
            collection: businessDoc.collection,
          }),
        };
      }
      return { doc: vi.fn() };
    }) as never);

    const result = await reconcileByogRefillPolicyIfNeeded("biz1", "cust1", [
      { qty: 10 },
    ]);

    expect(result.upgraded).toBe(false);
    expect(CustomerService.updateCustomer).not.toHaveBeenCalled();
  });
});
