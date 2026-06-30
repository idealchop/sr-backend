import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GeocodingService } from "../../../../services/maps/geocoding-service";

describe("GeocodingService", () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.GOOGLE_MAPS_API_KEY;

  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = "test-maps-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) {
      delete process.env.GOOGLE_MAPS_API_KEY;
    } else {
      process.env.GOOGLE_MAPS_API_KEY = originalKey;
    }
  });

  it("returns null when address is blank", async () => {
    await expect(GeocodingService.geocodeAddress("   ")).resolves.toBeNull();
  });

  it("returns coordinates from a successful Geocoding API response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [
          {
            formatted_address: "123 Rizal St, Quezon City, Metro Manila, Philippines",
            geometry: { location: { lat: 14.676, lng: 121.0437 } },
          },
        ],
      }),
    }) as typeof fetch;

    const hit = await GeocodingService.geocodeAddress(
      "123 Rizal St Quezon City",
    );
    expect(hit).toEqual({
      latitude: 14.676,
      longitude: 121.0437,
      formattedAddress:
        "123 Rizal St, Quezon City, Metro Manila, Philippines",
    });
    const url = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toContain("Philippines");
  });

  it("logs and returns null when maps API key is missing", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    await expect(
      GeocodingService.geocodeAddress("123 Rizal St, Quezon City"),
    ).resolves.toBeNull();
  });

  it("returns null when API status is not OK", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ZERO_RESULTS", results: [] }),
    }) as typeof fetch;

    await expect(
      GeocodingService.geocodeAddress("Unknown place"),
    ).resolves.toBeNull();
  });

  it("reverse-geocodes coordinates via latlng query", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [
          {
            formatted_address: "SM North EDSA, Quezon City, Philippines",
            geometry: { location: { lat: 14.656, lng: 121.031 } },
          },
        ],
      }),
    }) as typeof fetch;

    const hit = await GeocodingService.reverseGeocodeCoordinates(14.656, 121.031);
    expect(hit).toEqual({
      latitude: 14.656,
      longitude: 121.031,
      formattedAddress: "SM North EDSA, Quezon City, Philippines",
    });

    const url = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toContain("latlng=14.656%2C121.031");
  });
});
