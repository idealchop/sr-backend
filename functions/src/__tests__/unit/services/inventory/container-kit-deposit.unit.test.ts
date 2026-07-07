import { describe, expect, it } from "vitest";
import {
  buildShellIdSet,
  computeContainerDepositGap,
  normalizeCustomerContainerDeposit,
} from "../../../../services/customers/container-deposit";
import { inferInventoryItemRole } from "../../../../services/inventory/container-kit";

describe("container-kit (backend)", () => {
  it("infers shell from container names", () => {
    expect(inferInventoryItemRole("5 Gallon Round", undefined)).toBe(
      "container_shell",
    );
    expect(inferInventoryItemRole("Faucet", "kit_component")).toBe(
      "kit_component",
    );
  });
});

describe("container-deposit (backend)", () => {
  it("builds shell id set from roles and names", () => {
    const ids = buildShellIdSet([
      { id: "a", name: "5 Gallon", inventoryRole: "general" },
      { id: "b", name: "Cap", inventoryRole: "kit_component" },
    ]);
    expect([...ids]).toEqual(["a"]);
  });

  it("detects deposit gap for WRS possession", () => {
    const shellIds = new Set(["shell1"]);
    const gap = computeContainerDepositGap(
      {
        containerPolicy: "wrs_rotation",
        possession: { shell1: { quantity: 2 } },
        containerDeposit: normalizeCustomerContainerDeposit({
          balance: 500,
          shellsCovered: 1,
          updatedAt: "2026-06-29T00:00:00.000Z",
        }),
      },
      { containerDefaultPolicy: "wrs_rotation" },
      shellIds,
    );
    expect(gap?.uncoveredShells).toBe(1);
    expect(gap?.hasGap).toBe(true);
  });
});
