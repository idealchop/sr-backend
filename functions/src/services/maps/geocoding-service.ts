import { logger } from "../observability/logging/logger";
import { GEOCODER_USER_AGENT, PH_BBOX, nominatimBaseUrl, photonBaseUrl } from "./maps-config";

export type GeocodeResult = {
  latitude: number;
  longitude: number;
  formattedAddress?: string;
};

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | undefined>;
};
type NominatimHit = { lat?: string; lon?: string; display_name?: string };

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 1000;
const cache = new Map<string, { at: number; hit: GeocodeResult | null }>();

function cacheGet(key: string): GeocodeResult | null | undefined {
  const c = cache.get(key);
  if (!c) return undefined;
  if (Date.now() - c.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return c.hit;
}
function cacheSet(key: string, hit: GeocodeResult | null): void {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), hit });
}

/** Nominatim policy: at most 1 request per second per app — serialize calls with a 1.1s gap. */
let nominatimChain: Promise<unknown> = Promise.resolve();
let lastNominatimAt = 0;
function throttleNominatim<T>(fn: () => Promise<T>): Promise<T> {
  const run = nominatimChain.then(async () => {
    const wait = lastNominatimAt + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatimAt = Date.now();
    return fn();
  });
  nominatimChain = run.catch(() => undefined);
  return run;
}

function inPhilippines(lat: number, lng: number): boolean {
  return lat >= 4.5 && lat <= 21.2 && lng >= 116.9 && lng <= 126.7;
}

function valid(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === "number" && typeof lng === "number" &&
    Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)
  );
}

function photonLabel(p: Record<string, string | undefined>): string {
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  return [
    p.name, street && street !== p.name ? street : "",
    p.district || p.locality, p.city || p.county, p.state, "Philippines",
  ]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(", ");
}

async function getJson<T>(url: string, timeoutMs: number): Promise<T | null> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": GEOCODER_USER_AGENT,
      "Accept": "application/json",
      "Accept-Language": "en",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    logger.warn("GeocodingService http_error", { status: response.status, host: new URL(url).host });
    return null;
  }
  return (await response.json()) as T;
}

/**
 * Resolves Philippines addresses / pins with open OpenStreetMap geocoders (no Google, no key):
 * Photon (komoot) first, Nominatim as fallback
 * (throttled to 1 req/s, identified User-Agent, cached).
 */
export class GeocodingService {
  /** Kept for callers/logs: open geocoding needs no key, so it is always available. */
  static isAvailable(): boolean {
    return true;
  }

  private static async photonSearch(query: string): Promise<GeocodeResult | null> {
    const url = `${photonBaseUrl()}/api/?q=${encodeURIComponent(query)}` +
      `&limit=1&lang=en&bbox=${PH_BBOX}`;
    const d = await getJson<{ features?: PhotonFeature[] }>(url, 4000);
    const f = d?.features?.[0];
    const [lng, lat] = f?.geometry?.coordinates ?? [];
    if (!valid(lat, lng) || !inPhilippines(lat, lng as number)) return null;
    return {
      latitude: lat,
      longitude: lng as number,
      formattedAddress: photonLabel(f?.properties ?? {}) || undefined,
    };
  }

  private static async nominatimSearch(query: string): Promise<GeocodeResult | null> {
    const url = `${nominatimBaseUrl()}/search?q=${encodeURIComponent(query)}` +
      "&format=jsonv2&countrycodes=ph&limit=1&accept-language=en";
    const d = await throttleNominatim(() => getJson<NominatimHit[]>(url, 6000));
    const hit = d?.[0];
    const lat = Number(hit?.lat);
    const lng = Number(hit?.lon);
    if (!valid(lat, lng)) return null;
    return { latitude: lat, longitude: lng, formattedAddress: hit?.display_name };
  }

  static async geocodeAddress(
    address: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _region = "ph",
  ): Promise<GeocodeResult | null> {
    const trimmed = address.trim();
    if (!trimmed) return null;
    const query = /\bphilippines\b/i.test(trimmed) ? trimmed : `${trimmed}, Philippines`;
    const key = `f:${query.toLowerCase()}`;
    const cached = cacheGet(key);
    if (cached !== undefined) return cached;

    let hit: GeocodeResult | null = null;
    try {
      hit = await GeocodingService.photonSearch(query);
    } catch (error) {
      logger.warn("GeocodingService.photon failed", { error: String(error) });
    }
    if (!hit) {
      try {
        hit = await GeocodingService.nominatimSearch(trimmed);
      } catch (error) {
        logger.warn("GeocodingService.nominatim failed", { error: String(error) });
      }
    }
    if (!hit) {
      logger.warn("GeocodingService.geocodeAddress no_match", { address: trimmed.slice(0, 120) });
    }
    cacheSet(key, hit);
    return hit;
  }

  /** Reverse-geocode Messenger location pins to a readable address (Nominatim, throttled). */
  static async reverseGeocodeCoordinates(
    latitude: number,
    longitude: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _region = "ph",
  ): Promise<GeocodeResult | null> {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    const key = `r:${latitude.toFixed(5)},${longitude.toFixed(5)}`;
    const cached = cacheGet(key);
    if (cached !== undefined) return cached;
    let hit: GeocodeResult | null = null;
    try {
      const url = `${nominatimBaseUrl()}/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}` +
        "&zoom=18&addressdetails=0&accept-language=en";
      const d = await throttleNominatim(() => getJson<{ display_name?: string }>(url, 6000));
      if (d?.display_name) hit = { latitude, longitude, formattedAddress: d.display_name };
    } catch (error) {
      logger.warn("GeocodingService.reverse failed", { error: String(error) });
    }
    cacheSet(key, hit);
    return hit;
  }

  /** Test hook. */
  static clearCache(): void {
    cache.clear();
    lastNominatimAt = 0;
  }
}
