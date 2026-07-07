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
import { isContainerInventoryName } from "../../../../services/inventory/container-catalog-utils";
import { applyPortalContainerSetup } from "../../../../services/portal/portal-container-setup-service";

describe("isContainerInventoryName", () => {
  it("matches gallon and container names", () => {
    expect(isContainerInventoryName("5 Gallon Slim")).toBe(true);
    expect(isContainerInventoryName("Purified Water")).toBe(false);
  });
});

describe("applyPortalContainerSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets WRS rotation policy without touching possession", async () => {
    vi.mocked(CustomerService.updateCustomer).mockResolvedValue(undefined as never);

    await applyPortalContainerSetup("biz1", "cust1", {
      containerPolicy: "wrs_rotation",
    });

    expect(CustomerService.updateCustomer).toHaveBeenCalledWith("biz1", "cust1", {
      containerPolicy: "wrs_rotation",
    });
    expect(CustomerService.getCustomer).not.toHaveBeenCalled();
  });

  it("sets BYOG policy and possession for declared container catalog items", async () => {
    const inventoryGet = vi.fn().mockResolvedValue({
      docs: [
        { id: "g1", data: () => ({ name: "5 Gallon Slim" }) },
        { id: "g2", data: () => ({ name: "5 Gallon Round" }) },
      ],
    });
    const businessDoc = { collection: vi.fn().mockReturnValue({ get: inventoryGet }) };
    vi.mocked(db.collection).mockReturnValue({
      doc: vi.fn().mockReturnValue(businessDoc),
    } as never);

    vi.mocked(CustomerService.getCustomer).mockResolvedValue({
      possession: {
        g1: { itemName: "Old", quantity: 2 },
        other: { itemName: "Water dispenser", quantity: 1 },
      },
    } as never);
    vi.mocked(CustomerService.updateCustomer).mockResolvedValue(undefined as never);

    await applyPortalContainerSetup("biz1", "cust1", {
      containerPolicy: "byog",
      ownContainers: [{ inventoryId: "g2", quantity: 3 }],
    });

    expect(CustomerService.updateCustomer).toHaveBeenCalledWith("biz1", "cust1", {
      containerPolicy: "byog",
      possession: {
        other: { itemName: "Water dispenser", quantity: 1 },
        g2: { itemName: "5 Gallon Round", quantity: 3 },
      },
    });
  });

  it("rejects BYOG without container rows", async () => {
    await expect(
      applyPortalContainerSetup("biz1", "cust1", {
        containerPolicy: "byog",
        ownContainers: [],
      }),
    ).rejects.toThrow("BYOG_CONTAINERS_REQUIRED");
  });
});
