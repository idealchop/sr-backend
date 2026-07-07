import { describe, expect, it } from "vitest";
import { resolveActiveListTarget } from "../../../../services/rider/rider-messenger-list-target";
import type {
  RiderMessengerJobRow,
  RiderMessengerNearbyRow,
  RiderMessengerSessionDoc,
} from "../../../../services/rider/rider-messenger-types";

const jobs: RiderMessengerJobRow[] = [
  {
    index: 1,
    transactionId: "tx1",
    referenceId: "TX-1001",
    customerName: "Ana",
    type: "delivery",
    deliveryStatus: "pending",
  },
];

const nearby: RiderMessengerNearbyRow[] = [
  {
    index: 1,
    customerId: "c1",
    customerName: "Ben",
    type: "delivery",
    distanceKm: 0.5,
    source: "dormant",
    daysSinceLastOrder: 10,
  },
];

describe("resolveActiveListTarget", () => {
  it("prefers group_detail list when active", () => {
    const session = {
      activeList: "group_detail",
      lastNearby: nearby,
    } as RiderMessengerSessionDoc;

    expect(resolveActiveListTarget({ session, jobs, token: "1" })).toEqual({
      list: "group_detail",
      nearby: nearby[0],
    });
  });

  it("uses jobs list when active (ignores stale nearby)", () => {
    const session = {
      activeList: "jobs",
      lastNearby: nearby,
    } as RiderMessengerSessionDoc;

    expect(resolveActiveListTarget({ session, jobs, token: "1" })).toEqual({
      list: "jobs",
      job: jobs[0],
    });
  });

  it("returns null for nearby index without group detail", () => {
    const session = {
      activeList: "nearby",
      lastNearbyGroups: [],
    } as RiderMessengerSessionDoc;

    expect(resolveActiveListTarget({ session, jobs, token: "1" })).toBeNull();
  });

  it("does not fall back to jobs when group_detail # missing", () => {
    const session = {
      activeList: "group_detail",
      lastNearby: nearby,
    } as RiderMessengerSessionDoc;

    expect(resolveActiveListTarget({ session, jobs, token: "9" })).toBeNull();
  });
});
