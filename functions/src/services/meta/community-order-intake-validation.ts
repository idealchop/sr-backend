import { GeocodingService } from "../maps/geocoding-service";
import type { CommunityDispatchGeocode } from "./community-dispatch-request-types";
import {
  formatCommunityOrderLines,
  parseCommunityOrderLines,
  type CommunityOrderFields,
} from "./community-dispatch-template-parser";

export type CommunityIntakeQualityIssue = "address" | "order";

export type CommunityIntakeQualityResult = {
  ok: boolean;
  issue?: CommunityIntakeQualityIssue;
  geocode?: CommunityDispatchGeocode;
};

export function usesCommunityOrderFormFormat(fields: CommunityOrderFields): boolean {
  return Boolean(fields.orderRaw || fields.orderLines?.length);
}

export function hasValidCommunityOrderLines(fields: CommunityOrderFields): boolean {
  if (fields.orderLines?.length) return true;

  if (fields.orderRaw?.trim()) {
    return parseCommunityOrderLines(fields.orderRaw).length > 0;
  }

  return fields.qty !== undefined && fields.qty > 0 && !usesCommunityOrderFormFormat(fields);
}

export function isCommunityOrderFormatInvalid(fields: CommunityOrderFields): boolean {
  if (!usesCommunityOrderFormFormat(fields)) return false;
  return !hasValidCommunityOrderLines(fields);
}

export async function geocodeCommunityDeliveryAddress(
  location: string | undefined,
): Promise<CommunityDispatchGeocode | null> {
  const trimmed = location?.trim();
  if (!trimmed) return null;

  const hit = await GeocodingService.geocodeAddress(trimmed);
  if (!hit) return null;

  return {
    latitude: hit.latitude,
    longitude: hit.longitude,
    formattedAddress: hit.formattedAddress,
  };
}

/** Address geocode + order line format — address is checked first. */
export async function validateCommunityOrderIntakeQuality(
  fields: CommunityOrderFields,
  geocodeHint?: CommunityDispatchGeocode,
): Promise<CommunityIntakeQualityResult> {
  const isDelivery = fields.delivery !== false;

  if (isDelivery) {
    const geocode = geocodeHint ?? await geocodeCommunityDeliveryAddress(fields.location);
    if (!geocode) {
      return { ok: false, issue: "address" };
    }

    if (!hasValidCommunityOrderLines(fields)) {
      return { ok: false, issue: "order", geocode };
    }

    return { ok: true, geocode };
  }

  if (!hasValidCommunityOrderLines(fields)) {
    return { ok: false, issue: "order" };
  }

  return { ok: true };
}

export function applyCommunityOrderTextPatch(
  base: CommunityOrderFields,
  text: string,
): CommunityOrderFields {
  const trimmed = text.trim();
  const lines = parseCommunityOrderLines(trimmed);
  if (!lines.length) return base;

  return {
    ...base,
    orderRaw: trimmed.slice(0, 240),
    orderLines: lines,
    qty: lines.reduce((sum, line) => sum + line.qty, 0),
    preferredWaterType: formatCommunityOrderLines(lines),
  };
}
