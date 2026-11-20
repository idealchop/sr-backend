import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMock, whereMock, limitMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  whereMock: vi.fn(),
  limitMock: vi.fn(),
}));

vi.mock("../../../../config/firebase-admin", () => {
  const chain: Record<string, unknown> = {};
  chain.where = (...args: unknown[]) => {
    whereMock(...args);
    return chain;
  };
  chain.limit = (n: number) => {
    limitMock(n);
    return { get: getMock };
  };
  chain.get = () => {
    throw new Error("unbounded get() is not allowed");
  };
  return {
    db: {
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({ collection: vi.fn(() => chain) })),
      })),
    },
  };
});

import {
  countRiderOtherActiveStops,
  RIDER_OTHER_ACTIVE_STOPS_CAP,
} from "../../../../services/portal/portal-rider-active-stops";

const docs = (ids: string[]) => ({ docs: ids.map((id) => ({ id })) });

describe("countRiderOtherActiveStops", () => {
  beforeEach(() => {
    getMock.mockReset();
    whereMock.mockReset();
    limitMock.mockReset();
  });

  it("uses a filtered, capped query (riderId + active deliveryStatus in, limit)", async () => {
    getMock.mockResolvedValue(docs(["a", "b"]));
    await countRiderOtherActiveStops("biz", "rider-1", "cur");
    expect(whereMock).toHaveBeenCalledWith("riderId", "==", "rider-1");
    expect(whereMock).toHaveBeenCalledWith("deliveryStatus", "in", [
      "pending",
      "placed",
      "in-transit",
    ]);
    expect(limitMock).toHaveBeenCalledWith(RIDER_OTHER_ACTIVE_STOPS_CAP + 1);
  });

  it("excludes the current transaction", async () => {
    getMock.mockResolvedValue(docs(["cur", "a", "b"]));
    await expect(countRiderOtherActiveStops("biz", "r", "cur")).resolves.toBe(2);
  });

  it("caps the count at 50", async () => {
    const many = Array.from({ length: 51 }, (_, i) => `t${i}`);
    getMock.mockResolvedValue(docs(many));
    await expect(countRiderOtherActiveStops("biz", "r", "cur")).resolves.toBe(50);
  });
});
