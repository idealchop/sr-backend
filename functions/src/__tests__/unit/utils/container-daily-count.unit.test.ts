import { describe, expect, it } from "vitest";
import {
  buildContainerCountContext,
  countWaterContainerQuantity,
} from "../../../utils/container-daily-count";

describe("countWaterContainerQuantity", () => {
  const ctx = buildContainerCountContext(
    [
      { id: "round", iconId: "round-gallon", itemOnly: false },
      { id: "bottle", iconId: "350-ml", itemOnly: false },
      { id: "faucet", iconId: "Dispenser", itemOnly: true },
    ],
    [
      { id: "round-gallon", waterContainer: true },
      { id: "slim-gallon", waterContainer: true },
      { id: "350-ml", waterContainer: false },
      { id: "Dispenser", waterContainer: false },
    ],
  );

  it("counts gallon icons and skips bottles that are not water containers", () => {
    expect(
      countWaterContainerQuantity({
        type: "walkin",
        deliveryStatus: "completed",
        ...ctx,
        waterRefills: [
          { productId: "bottle", quantity: 21 },
          { productId: "round", quantity: 21 },
        ],
      }),
    ).toBe(21);
  });

  it("counts a bottle only when its product icon is marked waterContainer", () => {
    const withBottleIcon = buildContainerCountContext(
      [{ id: "bottle", iconId: "1liter-bottle", itemOnly: false }],
      [{ id: "1liter-bottle", waterContainer: true }],
    );
    expect(
      countWaterContainerQuantity({
        type: "walkin",
        ...withBottleIcon,
        waterRefills: [{ productId: "bottle", quantity: 6 }],
      }),
    ).toBe(6);
  });

  it("uses refill names when the product catalog is missing so bottles are not counted as gallons", () => {
    const emptyCtx = buildContainerCountContext(
      [],
      [
        { id: "round-gallon", waterContainer: true },
        { id: "350-ml", waterContainer: false },
      ],
    );
    expect(
      countWaterContainerQuantity({
        type: "walkin",
        deliveryStatus: "completed",
        ...emptyCtx,
        waterRefills: [
          {
            name: "350ml Mineral Bottle",
            productId: "unknown-bottle",
            quantity: 21,
          },
          {
            name: "Round Purified",
            productId: "unknown-round",
            quantity: 21,
          },
        ],
      }),
    ).toBe(21);
  });

  it("sums water-container quantities across tickets, not the ticket count", () => {
    const ctxFour = buildContainerCountContext(
      [
        { id: "round", iconId: "round-gallon", itemOnly: false },
        { id: "bottle", iconId: "350-ml", itemOnly: false },
      ],
      [
        { id: "round-gallon", waterContainer: true },
        { id: "350-ml", waterContainer: false },
      ],
    );
    const tickets = [
      [{ productId: "round", quantity: 11 }],
      [{ productId: "round", quantity: 1 }],
      [
        { productId: "bottle", quantity: 21 },
        { productId: "round", quantity: 21 },
      ],
      [{ productId: "round", quantity: 2 }],
    ];
    const used = tickets.reduce(
      (sum, waterRefills) =>
        sum +
        countWaterContainerQuantity({
          type: "walkin",
          deliveryStatus: "completed",
          ...ctxFour,
          waterRefills,
        }),
      0,
    );
    expect(used).toBe(35);
    expect(tickets).toHaveLength(4);
  });

  it("skips store-only catalog rows, collections, and cancelled stops", () => {
    expect(
      countWaterContainerQuantity({
        type: "walkin",
        ...ctx,
        waterRefills: [{ productId: "faucet", quantity: 4 }],
      }),
    ).toBe(0);
    expect(
      countWaterContainerQuantity({
        type: "collection",
        ...ctx,
        waterRefills: [{ productId: "round", quantity: 8 }],
      }),
    ).toBe(0);
    expect(
      countWaterContainerQuantity({
        type: "delivery",
        deliveryStatus: "cancelled",
        ...ctx,
        waterRefills: [{ productId: "round", quantity: 6 }],
      }),
    ).toBe(0);
  });
});
