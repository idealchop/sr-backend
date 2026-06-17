import { logger } from "../observability/logging/logger";

export type GeocodeResult = {
  latitude: number;
  longitude: number;
  formattedAddress?: string;
};

import { getGoogleMapsApiKey } from "./maps-config";

/**
 * Resolves a free-text Philippines address to coordinates via Google Geocoding API.
 * Returns null when the API key is missing or no match is found.
 */
export class GeocodingService {
  static readApiKey(): string | null {
    const key = getGoogleMapsApiKey();
    return key || null;
  }

  static async geocodeAddress(
    address: string,
    region = "ph",
  ): Promise<GeocodeResult | null> {
    const trimmed = address.trim();
    const apiKey = getGoogleMapsApiKey();
    if (!trimmed || !apiKey) return null;

    try {
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      url.searchParams.set("address", trimmed);
      url.searchParams.set("key", apiKey);
      url.searchParams.set("region", region);

      const response = await fetch(url.toString());
      if (!response.ok) {
        logger.warn("GeocodingService.geocodeAddress http_error", {
          status: response.status,
        });
        return null;
      }

      const payload = (await response.json()) as {
        status?: string;
        results?: Array<{
          formatted_address?: string;
          geometry?: { location?: { lat?: number; lng?: number } };
        }>;
      };

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
    } catch (error) {
      logger.warn("GeocodingService.geocodeAddress failed", { error });
      return null;
    }
  }
}
