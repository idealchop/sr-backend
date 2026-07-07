import { describe, expect, it } from "vitest";
import {
  jobMatchesNearbyGroup,
  parseGroupBulkTarget,
  splitCashAcrossJobs,
} from "../../../../services/rider/rider-messenger-group-actions-service";
import type { RiderMessengerNearbyGroup } from "../../../../services/rider/rider-messenger-types";

describe("parseGroupBulkTarget", () => {
  it("parses GROUP bulk target", () => {
    expect(parseGroupBulkTarget("GROUP 1")).toEqual({
      scope: "group",
      groupNumber: "1",
    });
    expect(parseGroupBulkTarget("GROUP 2 CASH 150")).toEqual({
      scope: "group",
      groupNumber: "2",
      cashAmount: 150,
    });
  });

  it("parses single target", () => {
    expect(parseGroupBulkTarget("2")).toEqual({ scope: "single", target: "2" });
  });
});

describe("jobMatchesNearbyGroup", () => {
  const group: RiderMessengerNearbyGroup = {
    groupNumber: 1,
    label: "Cluster A",
    stopCount: 2,
    spanM: 100,
    nearestDistanceKm: 0.5,
    quietCount: 0,
    members: [
      {
        source: "order",
        customerId: "c1",
        transactionId: "tx1",
        referenceId: "TX-1",
        customerName: "Ana",
        type: "delivery",
        distanceKm: 0.5,
        assignedRiderName: "You",
        isOverride: false,
        lat: 1,
        lng: 2,
      },
    ],
  };

  it("matches by transaction or customer id", () => {
    expect(
      jobMatchesNearbyGroup(
        {
          index: 1,
          transactionId: "tx1",
          referenceId: "TX-1",
          customerName: "Ana",
          type: "delivery",
          status: "in-transit",
          itemsSummary: "1 refill",
          isTodo: true,
          isDoneToday: false,
        },
        { customerId: "c1" } as never,
        group,
      ),
    ).toBe(true);
  });
});

describe("splitCashAcrossJobs", () => {
  it("splits cash evenly with remainder", () => {
    expect(splitCashAcrossJobs(100, 3)).toEqual([33.34, 33.33, 33.33]);
  });
});
