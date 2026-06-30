import { FieldValue } from "../../config/firebase-admin";

export function isValidCustomerMapCoordinate(
  lat: unknown,
  lng: unknown,
): boolean {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

export function resolveCustomerLocationForWrite(input: {
  address?: string;
  latitude?: number;
  longitude?: number;
}): { address: string; latitude?: number; longitude?: number } {
  const address = (input.address ?? "").trim();
  const hasCoords = isValidCustomerMapCoordinate(
    input.latitude,
    input.longitude,
  );

  if (!address || !hasCoords) {
    return { address };
  }

  return {
    address,
    latitude: input.latitude,
    longitude: input.longitude,
  };
}

export function applyCustomerLocationPatch(
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const patch = { ...updates };
  delete patch.coordinates;

  const hasAddressKey = "address" in updates;
  const hasLatitudeKey = "latitude" in updates;
  const hasLongitudeKey = "longitude" in updates;
  const touchesLocation = hasAddressKey || hasLatitudeKey || hasLongitudeKey;
  if (!touchesLocation) {
    return patch;
  }

  // Map-pin-only update (e.g. rider GPS at customer site): coords change, address text stays.
  if (hasLatitudeKey && hasLongitudeKey && !hasAddressKey) {
    const lat = updates.latitude;
    const lng = updates.longitude;
    if (isValidCustomerMapCoordinate(lat, lng)) {
      patch.latitude = lat;
      patch.longitude = lng;
    } else {
      patch.latitude = FieldValue.delete();
      patch.longitude = FieldValue.delete();
    }
    return patch;
  }

  const resolved = resolveCustomerLocationForWrite({
    address: typeof updates.address === "string" ? updates.address : "",
    latitude:
      typeof updates.latitude === "number" ? updates.latitude : undefined,
    longitude:
      typeof updates.longitude === "number" ? updates.longitude : undefined,
  });

  patch.address = resolved.address;

  if (resolved.latitude != null && resolved.longitude != null) {
    patch.latitude = resolved.latitude;
    patch.longitude = resolved.longitude;
  } else {
    patch.latitude = FieldValue.delete();
    patch.longitude = FieldValue.delete();
  }

  return patch;
}
