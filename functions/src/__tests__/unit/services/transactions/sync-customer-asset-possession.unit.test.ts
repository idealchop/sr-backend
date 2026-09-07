import { describe, expect, it } from "vitest";
import {
  customerTracksContainers,
  isContainerPossessionInventory,
} from "../../../../services/transactions/sync-customer-asset-possession";

describe("customerTracksContainers", () => {
  it("requires trackContainers true before order sync can adjust held qty", () => {
    expect(customerTracksContainers(undefined)).toBe(false);
    expect(customerTracksContainers({})).toBe(false);
    expect(customerTracksContainers({ trackContainers: false })).toBe(false);
    expect(customerTracksContainers({ trackContainers: true })).toBe(true);
  });
});

describe("isContainerPossessionInventory", () => {
  it("accepts shell and owned shape roles", () => {
    expect(isContainerPossessionInventory("Slim", "container_slim")).toBe(true);
    expect(isContainerPossessionInventory("Round", "container_round")).toBe(true);
    expect(isContainerPossessionInventory("WRS Shell", "container_shell")).toBe(true);
  });

  it("rejects general / non-container stock such as Payatot bags", () => {
    expect(isContainerPossessionInventory("Payatot", "general")).toBe(false);
    expect(isContainerPossessionInventory("Cap", "kit_component")).toBe(false);
  });
});
