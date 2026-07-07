import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../services/inventory/inventory-service", () => ({
  InventoryService: {
    getItem: vi.fn(),
  },
}));

import { InventoryService } from "../../../../services/inventory/inventory-service";
import { submissionHasDeliveryOwnedAssetAddons } from "../../../../services/portal/delivery-owned-asset-addon";

describe("submissionHasDeliveryOwnedAssetAddons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when delivery add-ons are disabled", async () => {
    const result = await submissionHasDeliveryOwnedAssetAddons(
      "biz1",
      [{ inventoryId: "round-1", qty: 2, unitPrice: 350 }],
      false,
    );
    expect(result).toBe(false);
    expect(InventoryService.getItem).not.toHaveBeenCalled();
  });

  it("returns true for priced round catalog line", async () => {
    vi.mocked(InventoryService.getItem).mockResolvedValue({
      id: "round-1",
      name: "5 Gallon Round",
      inventoryRole: "container_round",
    } as never);

    const result = await submissionHasDeliveryOwnedAssetAddons(
      "biz1",
      [{ inventoryId: "round-1", qty: 2, unitPrice: 350 }],
      true,
    );
    expect(result).toBe(true);
  });

  it("returns false when priced line is not a round/slim container", async () => {
    vi.mocked(InventoryService.getItem).mockResolvedValue({
      id: "faucet-1",
      name: "Faucet",
      inventoryRole: "general",
    } as never);

    const result = await submissionHasDeliveryOwnedAssetAddons(
      "biz1",
      [{ inventoryId: "faucet-1", qty: 1, unitPrice: 120 }],
      true,
    );
    expect(result).toBe(false);
  });
});
