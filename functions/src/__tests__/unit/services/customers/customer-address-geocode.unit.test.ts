import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../../services/maps/geocoding-service", () => ({
  GeocodingService: {
    geocodeAddress: vi.fn(),
  },
}));

import { GeocodingService } from "../../../../services/maps/geocoding-service";
import {
  enrichCustomerDraftsWithGeocoding,
  resolveCustomerLocationWithGeocode,
} from "../../../../services/customers/customer-address-geocode";

describe("resolveCustomerLocationWithGeocode", () => {
  beforeEach(() => {
    vi.mocked(GeocodingService.geocodeAddress).mockReset();
  });

  it("keeps valid coordinates from the import row", async () => {
    const resolved = await resolveCustomerLocationWithGeocode({
      address: "404 El Grande Ave",
      latitude: 14.45,
      longitude: 121.02,
    });
    expect(resolved).toEqual({
      address: "404 El Grande Ave",
      latitude: 14.45,
      longitude: 121.02,
    });
  });

  it("geocodes address text when coordinates are missing", async () => {
    vi.mocked(GeocodingService.geocodeAddress).mockResolvedValue({
      latitude: 14.676,
      longitude: 121.0437,
      formattedAddress: "123 Rizal St, Quezon City, Philippines",
    });

    const resolved = await resolveCustomerLocationWithGeocode({
      address: "123 Rizal St Quezon City",
    });

    expect(resolved).toMatchObject({
      address: "123 Rizal St, Quezon City, Philippines",
      latitude: 14.676,
      longitude: 121.0437,
      geocoded: true,
    });
  });
});

describe("enrichCustomerDraftsWithGeocoding", () => {
  beforeEach(() => {
    vi.mocked(GeocodingService.geocodeAddress).mockReset();
  });

  it("fills coordinates for rows with address only", async () => {
    vi.mocked(GeocodingService.geocodeAddress).mockResolvedValue({
      latitude: 14.1,
      longitude: 121.1,
      formattedAddress: "Pinned Address",
    });

    const result = await enrichCustomerDraftsWithGeocoding([
      { name: "A", phone: "1", address: "Some street" },
    ]);

    expect(result.rows[0]).toMatchObject({
      address: "Pinned Address",
      latitude: 14.1,
      longitude: 121.1,
    });
    expect(result.geocodedCount).toBe(1);
  });

  it("warns when an address has no geocode match", async () => {
    vi.mocked(GeocodingService.geocodeAddress).mockResolvedValue(null);

    const result = await enrichCustomerDraftsWithGeocoding([
      { name: "A", phone: "1", address: "Some street" },
    ]);

    expect(result.geocodedCount).toBe(0);
    expect(result.geocodeWarnings[0]).toMatch(/no match for 1 address/);
  });
});
