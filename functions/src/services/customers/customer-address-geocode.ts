import { GeocodingService } from "../maps/geocoding-service";
import { getGoogleMapsApiKey } from "../maps/maps-config";
import {
  isValidCustomerMapCoordinate,
  resolveCustomerLocationForWrite,
} from "./customer-location";

export type CustomerAddressLocation = {
  address: string;
  latitude?: number;
  longitude?: number;
  geocoded?: boolean;
};

export async function resolveCustomerLocationWithGeocode(input: {
  address?: string;
  latitude?: number;
  longitude?: number;
}): Promise<CustomerAddressLocation> {
  const fromInput = resolveCustomerLocationForWrite(input);
  if (fromInput.latitude != null && fromInput.longitude != null) {
    return fromInput;
  }

  const address = (input.address ?? fromInput.address ?? "").trim();
  if (!address) {
    return { address: fromInput.address };
  }

  const hit = await GeocodingService.geocodeAddress(address);
  if (!hit) {
    return { address };
  }

  return {
    address: hit.formattedAddress?.trim() || address,
    latitude: hit.latitude,
    longitude: hit.longitude,
    geocoded: true,
  };
}

export async function enrichCustomerDraftsWithGeocoding<
  T extends { address: string; latitude?: number; longitude?: number },
>(rows: T[]): Promise<{
  rows: T[];
  geocodedCount: number;
  geocodeWarnings: string[];
}> {
  const geocodeWarnings: string[] = [];
  let geocodedCount = 0;
  const enriched: T[] = [];

  for (const row of rows) {
    const next = { ...row };
    const hasCoords = isValidCustomerMapCoordinate(
      next.latitude,
      next.longitude,
    );

    if (!hasCoords && next.address.trim()) {
      const resolved = await resolveCustomerLocationWithGeocode({
        address: next.address,
        latitude: next.latitude,
        longitude: next.longitude,
      });
      if (resolved.latitude != null && resolved.longitude != null) {
        next.address = resolved.address;
        next.latitude = resolved.latitude;
        next.longitude = resolved.longitude;
        geocodedCount += 1;
      }
    } else if (hasCoords) {
      const normalized = resolveCustomerLocationForWrite({
        address: next.address,
        latitude: next.latitude,
        longitude: next.longitude,
      });
      next.address = normalized.address;
      next.latitude = normalized.latitude;
      next.longitude = normalized.longitude;
    }

    enriched.push(next);
  }

  if (!getGoogleMapsApiKey()) {
    const needsGeocode = rows.some(
      (row) =>
        row.address.trim() &&
        !isValidCustomerMapCoordinate(row.latitude, row.longitude),
    );
    if (needsGeocode) {
      geocodeWarnings.push(
        "Map pin lookup is unavailable (Google Maps API key not configured on the API). " +
          "Customers will import with address text only.",
      );
    }
  }

  return { rows: enriched, geocodedCount, geocodeWarnings };
}
