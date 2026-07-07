import { describe, expect, it } from "vitest";
import { buildNearbyRouteGroups } from "../../../../utils/geo-clustering";
import {
  formatGroupDetailMessage,
  formatNearbyIndexMessage,
  groupDetailRows,
  resolveNearbyGroup,
} from "../../../../services/rider/rider-messenger-nearby-service";
import type { RiderMessengerNearbyGroup } from "../../../../services/rider/rider-messenger-types";

describe("buildNearbyRouteGroups", () => {
  it("groups stops within cluster span", () => {
    const items = [
      { id: "a", lat: 14.6, lng: 120.98 },
      { id: "b", lat: 14.6001, lng: 120.9801 },
      { id: "c", lat: 14.61, lng: 120.99 },
    ];
    const groups = buildNearbyRouteGroups(items, (i) => ({ lat: i.lat, lng: i.lng }));
    expect(groups.some((g) => g.members.length >= 2)).toBe(true);
  });
});

describe("formatNearbyIndexMessage", () => {
  it("lists numbered groups, quiet count, and GROUP hint", () => {
    const groups: RiderMessengerNearbyGroup[] = [
      {
        groupNumber: 1,
        label: "GROUP 1",
        stopCount: 2,
        spanM: 280,
        nearestDistanceKm: 0.45,
        quietCount: 1,
        members: [
          {
            source: "order",
            customerId: "c1",
            transactionId: "tx1",
            referenceId: "TX-101",
            customerName: "Maria",
            type: "delivery",
            distanceKm: 0.45,
            assignedRiderName: null,
            isOverride: false,
            lat: 14.6,
            lng: 120.98,
          },
          {
            source: "dormant",
            customerId: "c2",
            referenceId: "QUIET",
            customerName: "Pedro",
            type: "delivery",
            distanceKm: 0.5,
            assignedRiderName: null,
            isOverride: false,
            lat: 14.6001,
            lng: 120.9801,
            daysSinceLastOrder: 12,
          },
        ],
      },
    ];
    const message = formatNearbyIndexMessage(groups);
    expect(message).toContain("NEARBY");
    expect(message).toContain("quiet 7d+");
    expect(message).toContain("GROUP #");
  });
});

describe("formatGroupDetailMessage", () => {
  it("lists quiet sukis and open orders for CLAIM", () => {
    const group: RiderMessengerNearbyGroup = {
      groupNumber: 1,
      label: "GROUP 1",
      stopCount: 2,
      spanM: 0,
      nearestDistanceKm: 0.45,
      quietCount: 1,
      members: [
        {
          source: "dormant",
          customerId: "c1",
          referenceId: "QUIET",
          customerName: "Maria",
          type: "delivery",
          distanceKm: 0.45,
          assignedRiderName: null,
          isOverride: false,
          lat: 14.6,
          lng: 120.98,
          daysSinceLastOrder: 10,
        },
        {
          source: "order",
          customerId: "c2",
          transactionId: "tx2",
          referenceId: "TX-102",
          customerName: "Ana",
          type: "collection",
          distanceKm: 0.5,
          assignedRiderName: null,
          isOverride: false,
          lat: 14.61,
          lng: 120.99,
        },
      ],
    };
    const message = formatGroupDetailMessage(group);
    expect(message).toContain("quiet 10d");
    expect(message).toContain("TX-102");
    expect(message).toContain("CLAIM #");
    expect(groupDetailRows(group)).toHaveLength(2);
    expect(resolveNearbyGroup([group], "1")?.groupNumber).toBe(1);
  });
});
