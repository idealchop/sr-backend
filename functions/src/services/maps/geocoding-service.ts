import { logger } from "../observability/logging/logger";

export type GeocodeResult = {
  latitude: number;
  longitude: number;
  formattedAddress?: string;
};

import { getGoogleMapsApiKey } from "./maps-config";

type GeocodeApiPayload = {
  status?: string;
  results?: Array<{
    formatted_address?: string;
    geometry?: { location?: { lat?: number; lng?: number } };
  }>;
};

/**
 * Resolves a free-text Philippines address to coordinates via Google Geocoding API.
 * Returns null when the API key is missing or no match is found.
 */
export class GeocodingService {
  static readApiKey(): string | null {
    const key = getGoogleMapsApiKey();
    return key || null;
  }

  private static parseGeocodePayload(payload: GeocodeApiPayload): GeocodeResult | null {
    if (payload.status !== "OK" || !payload.results?.length) {
      return null;
    }

    const hit = payload.results[0];
    const lat = hit.geometry?.location?.lat;
    const lng = hit.geometry?.location?.lng;
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat === 0 && lng === 0) return null;

    return {
      latitude: lat,
      longitude: lng,
      formattedAddress: hit.formatted_address,
    };
  }

  private static async fetchGeocode(
    params: Record<string, string>,
    region = "ph",
  ): Promise<GeocodeResult | null> {
    const apiKey = getGoogleMapsApiKey();
    if (!apiKey) return null;

    try {
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
      url.searchParams.set("key", apiKey);
      url.searchParams.set("region", region);

      const response = await fetch(url.toString());
      if (!response.ok) {
        logger.warn("GeocodingService.fetchGeocode http_error", {
          status: response.status,
        });
        return null;
      }

      const payload = (await response.json()) as GeocodeApiPayload;
      if (payload.status !== "OK") {
        logger.warn("GeocodingService.fetchGeocode api_status", {
          status: payload.status,
          address: params.address?.slice(0, 120),
        });
      }
      return GeocodingService.parseGeocodePayload(payload);
    } catch (error) {
      logger.warn("GeocodingService.fetchGeocode failed", { error });
      return null;
    }
  }

  static async geocodeAddress(
    address: string,
    region = "ph",
  ): Promise<GeocodeResult | null> {
    const trimmed = address.trim();
    if (!trimmed) return null;

    if (!GeocodingService.readApiKey()) {
      logger.warn("GeocodingService.geocodeAddress skipped — maps API key missing");
      return null;
    }

    let query = trimmed;
    if (!/\bphilippines\b/i.test(query)) {
      query = `${query}, Philippines`;
    }

    const primary = await GeocodingService.fetchGeocode({ address: query }, region);
    if (primary) return primary;

    return GeocodingService.fetchGeocode(
      { address: trimmed, components: "country:PH" },
      region,
    );
  }

  /** Reverse-geocode Messenger location pins to a readable delivery address. */
  static async reverseGeocodeCoordinates(
    latitude: number,
    longitude: number,
    region = "ph",
  ): Promise<GeocodeResult | null> {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return GeocodingService.fetchGeocode(
      { latlng: `${latitude},${longitude}` },
      region,
    );
  }
}
