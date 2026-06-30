import { describe, expect, it } from "vitest";
import {
  COMMUNITY_OFFER_RESPONSE_MINUTES,
  estimateCommunityDeliveryEtaMinutes,
  formatDistanceKmForMessenger,
  formatEtaMinutesForMessenger,
  haversineDistanceKm,
} from "../../../../services/meta/community-dispatch-geo-utils";
import { resolveCommunityOrderAcceptedMetrics } from "../../../../services/meta/community-messenger-customer-notifier";

describe("community-dispatch-geo-utils", () => {
  it("formats sub-km distances in meters", () => {
    expect(formatDistanceKmForMessenger(0.42)).toBe("420 m");
  });

  it("formats km distances with one decimal under 10 km", () => {
    expect(formatDistanceKmForMessenger(2.44)).toBe("2.4 km");
  });

  it("estimates delivery ETA from prep + travel", () => {
    expect(estimateCommunityDeliveryEtaMinutes(2)).toBe(21);
    expect(estimateCommunityDeliveryEtaMinutes(0)).toBe(15);
  });

  it("formats ETA minutes for Messenger copy", () => {
    expect(formatEtaMinutesForMessenger(23)).toBe("about 23 minutes");
    expect(formatEtaMinutesForMessenger(60)).toBe("about 1 hour");
  });

  it("exposes offer response window matching offer TTL", () => {
    expect(COMMUNITY_OFFER_RESPONSE_MINUTES).toBe(3);
  });

  it("computes haversine distance between two points", () => {
    const km = haversineDistanceKm(14.676, 121.0437, 14.68, 121.03);
    expect(km).toBeGreaterThan(1);
    expect(km).toBeLessThan(3);
  });
});

describe("resolveCommunityOrderAcceptedMetrics", () => {
  it("returns distance and delivery ETA when geocode exists", () => {
    const metrics = resolveCommunityOrderAcceptedMetrics({
      request: {
        status: "accepted",
        sourceChannel: "community_messenger",
        metaPsid: "psid",
        metaMessageId: "mid",
        rawMessage: "order",
        parseSource: "template",
        referenceId: "CR-TEST",
        parsed: { name: "Ana", delivery: true, qty: 2, number: "09171234567" },
        geocode: { latitude: 14.676, longitude: 121.0437 },
      },
      stationLat: 14.68,
      stationLng: 121.03,
    });

    expect(metrics).not.toBeNull();
    if (!metrics) return;
    expect(metrics.distanceKm).toBeGreaterThan(0);
    expect(metrics.etaMinutes).toBeGreaterThanOrEqual(15);
  });

  it("returns null without customer geocode", () => {
    const metrics = resolveCommunityOrderAcceptedMetrics({
      request: {
        status: "accepted",
        sourceChannel: "community_messenger",
        metaPsid: "psid",
        metaMessageId: "mid",
        rawMessage: "order",
        parseSource: "template",
        referenceId: "CR-TEST",
        parsed: { name: "Ana", delivery: true, qty: 2, number: "09171234567" },
      },
      stationLat: 14.68,
      stationLng: 121.03,
    });

    expect(metrics).toBeNull();
  });
});
