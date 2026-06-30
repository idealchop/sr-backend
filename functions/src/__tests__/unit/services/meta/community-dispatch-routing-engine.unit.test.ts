import { describe, expect, it } from "vitest";
import { decideCommunityRouting } from "../../../../services/meta/community-dispatch-routing-engine";
import type { CommunityWrsDirectoryEntry } from "../../../../services/meta/community-dispatch-request-types";

const directory: CommunityWrsDirectoryEntry[] = [
  {
    businessId: "a",
    name: "AquaFlow Malabon",
    publicName: "AquaFlow Malabon",
    slug: "aquaflow-malabon",
    lat: 14.66,
    lng: 120.95,
    acceptingOrders: true,
  },
  {
    businessId: "b",
    name: "PureWave QC",
    publicName: "PureWave QC",
    slug: "purewave-qc",
    lat: 14.68,
    lng: 121.03,
    acceptingOrders: true,
  },
];

describe("decideCommunityRouting", () => {
  it("needs_location for delivery without geocode or substantial address", () => {
    const decision = decideCommunityRouting({
      fields: {
        name: "Ana",
        delivery: true,
        qty: 2,
        number: "09171234567",
        location: "somewhere vague",
      },
      geocode: null,
      directory,
    });

    expect(decision.status).toBe("needs_location");
  });

  it("broadcast offered for delivery with substantial address when geocode unavailable", () => {
    const decision = decideCommunityRouting({
      fields: {
        name: "Testing",
        delivery: true,
        qty: 4,
        number: "09123456789",
        location: "Puregold Hypermarket, National Road, Brgy Putatan, Muntinlupa City",
      },
      geocode: null,
      directory,
    });

    expect(decision.status).toBe("offered");
    expect(decision.candidateBusinessIds.length).toBeGreaterThan(0);
    expect(decision.routingNotes).toContain("map pin not verified");
  });

  it("broadcast all nearby stations within 5 km", () => {
    const decision = decideCommunityRouting({
      fields: {
        name: "Ana",
        delivery: true,
        qty: 2,
        number: "09171234567",
        location: "Quezon City",
      },
      geocode: { latitude: 14.676, longitude: 121.0437, formattedAddress: "QC" },
      directory,
      searchRadiusKm: 5,
    });

    expect(decision.status).toBe("offered");
    expect(decision.candidateBusinessIds).toEqual(["b"]);
  });

  it("no_stations when nothing within search radius", () => {
    const farDirectory: CommunityWrsDirectoryEntry[] = [
      {
        businessId: "far",
        name: "Far Station",
        publicName: "Far Station",
        lat: 14.0,
        lng: 120.0,
        acceptingOrders: true,
      },
    ];

    const decision = decideCommunityRouting({
      fields: {
        name: "Ana",
        delivery: true,
        qty: 2,
        number: "09171234567",
        location: "Quezon City",
      },
      geocode: { latitude: 14.676, longitude: 121.0437, formattedAddress: "QC" },
      directory: farDirectory,
      searchRadiusKm: 5,
    });

    expect(decision.status).toBe("no_stations");
    expect(decision.routingNotes).toContain("5 km");
  });

  it("pickup without geocode still broadcasts to directory", () => {
    const decision = decideCommunityRouting({
      fields: {
        name: "Ana",
        delivery: false,
        qty: 2,
        number: "09171234567",
      },
      geocode: null,
      directory,
    });

    expect(decision.status).toBe("offered");
    expect(decision.candidateBusinessIds).toEqual(["a", "b"]);
  });
});
