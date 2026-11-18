import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GeocodingService } from "../../../../services/maps/geocoding-service";
import { GEOCODER_USER_AGENT } from "../../../../services/maps/maps-config";

function photon(features: unknown[]) {
  return { ok: true, json: async () => ({ features }) };
}

describe("GeocodingService (Photon / Nominatim, no Google)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    GeocodingService.clearCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns null when address is blank", async () => {
    await expect(GeocodingService.geocodeAddress("   ")).resolves.toBeNull();
  });

  it("geocodes with Photon, PH-biased, with an identifying User-Agent", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      photon([
        {
          geometry: { coordinates: [121.0437, 14.676] },
          properties: { name: "123 Rizal St", city: "Quezon City", state: "Metro Manila" },
        },
      ]),
    ) as typeof fetch;

    const hit = await GeocodingService.geocodeAddress("123 Rizal St Quezon City");
    expect(hit).toEqual({
      latitude: 14.676,
      longitude: 121.0437,
      formattedAddress: "123 Rizal St, Quezon City, Metro Manila, Philippines",
    });
    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const [url, init] = calls[0] as [string, RequestInit];
    expect(url).toContain("photon.komoot.io");
    expect(url).toContain("Philippines");
    expect(url).toContain("bbox=116.9");
    expect(url).not.toContain("googleapis");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(GEOCODER_USER_AGENT);
  });

  it("caches repeated lookups", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      photon([{ geometry: { coordinates: [121.0, 14.6] }, properties: { name: "X" } }]),
    ) as typeof fetch;
    await GeocodingService.geocodeAddress("Same place");
    await GeocodingService.geocodeAddress("Same place");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to Nominatim when Photon has no PH match", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(photon([]))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ lat: "14.5", lon: "121.1", display_name: "Pasig, Metro Manila, Philippines" }],
      }) as typeof fetch;
    const hit = await GeocodingService.geocodeAddress("Pasig");
    expect(hit).toEqual({ latitude: 14.5, longitude: 121.1, formattedAddress: "Pasig, Metro Manila, Philippines" });
    const url = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as string;
    expect(url).toContain("nominatim.openstreetmap.org/search");
    expect(url).toContain("countrycodes=ph");
  });

  it("returns null when nothing matches", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(photon([]))
      .mockResolvedValueOnce({ ok: true, json: async () => [] }) as typeof fetch;
    await expect(GeocodingService.geocodeAddress("Unknown place")).resolves.toBeNull();
  });

  it("reverse-geocodes coordinates via Nominatim", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ display_name: "SM North EDSA, Quezon City, Philippines" }),
    }) as typeof fetch;

    const hit = await GeocodingService.reverseGeocodeCoordinates(14.656, 121.031);
    expect(hit).toEqual({
      latitude: 14.656,
      longitude: 121.031,
      formattedAddress: "SM North EDSA, Quezon City, Philippines",
    });
    const url = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toContain("nominatim.openstreetmap.org/reverse");
    expect(url).toContain("lat=14.656&lon=121.031");
  });
});
