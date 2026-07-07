/** Max distance between any two stops in one nearby group (~3–4 short blocks). */
export const NEARBY_CUSTOMER_CLUSTER_MAX_KM = 0.28;

/** Minimum stops required to form a named group. */
export const NEARBY_CUSTOMER_CLUSTER_MIN_SIZE = 2;

export type LatLng = { lat: number; lng: number };

function distanceKmLatLon(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function maxPairwiseSpanKm<T>(
  members: T[],
  getPoint: (item: T) => LatLng | null,
): number {
  let max = 0;
  for (let i = 0; i < members.length; i++) {
    const a = getPoint(members[i]);
    if (!a) continue;
    for (let j = i + 1; j < members.length; j++) {
      const b = getPoint(members[j]);
      if (!b) continue;
      max = Math.max(max, distanceKmLatLon(a.lat, a.lng, b.lat, b.lng));
    }
  }
  return max;
}

function completeLinkageDistanceKm<T>(
  left: T[],
  right: T[],
  getPoint: (item: T) => LatLng | null,
): number {
  let max = 0;
  for (const a of left) {
    const pa = getPoint(a);
    if (!pa) continue;
    for (const b of right) {
      const pb = getPoint(b);
      if (!pb) continue;
      max = Math.max(max, distanceKmLatLon(pa.lat, pa.lng, pb.lat, pb.lng));
    }
  }
  return max;
}

function clusterByMaxSpan<T>(
  items: T[],
  getPoint: (item: T) => LatLng | null,
  maxSpanKm: number,
): T[][] {
  if (items.length === 0) return [];

  const clusters: T[][] = [[]];

  for (const item of items) {
    let placed = false;
    for (const cluster of clusters) {
      const trial = [...cluster, item];
      if (maxPairwiseSpanKm(trial, getPoint) <= maxSpanKm) {
        cluster.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([item]);
  }

  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const left = clusters[i]!;
        const right = clusters[j]!;
        if (completeLinkageDistanceKm(left, right, getPoint) <= maxSpanKm) {
          clusters[i] = [...left, ...right];
          clusters.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }

  return clusters;
}

export type NearbyRouteGroup<T> = {
  label: string;
  members: T[];
  spanM: number;
};

/** Groups nearby stops so every pair in a group is within maxSpanKm. */
export function buildNearbyRouteGroups<T>(
  items: T[],
  getPoint: (item: T) => LatLng | null,
  options?: {
    maxSpanKm?: number;
    minGroupSize?: number;
  },
): NearbyRouteGroup<T>[] {
  const maxSpanKm = options?.maxSpanKm ?? NEARBY_CUSTOMER_CLUSTER_MAX_KM;
  const minGroupSize = options?.minGroupSize ?? NEARBY_CUSTOMER_CLUSTER_MIN_SIZE;

  const withCoords = items.filter((item) => getPoint(item));
  const rawClusters = clusterByMaxSpan(withCoords, getPoint, maxSpanKm);

  const groups: NearbyRouteGroup<T>[] = [];
  const solos: T[] = [];

  rawClusters.forEach((members, index) => {
    const spanM = Math.max(0, Math.round(maxPairwiseSpanKm(members, getPoint) * 1000));
    if (members.length >= minGroupSize) {
      groups.push({
        label: `GROUP ${groups.length + 1}`,
        members,
        spanM,
      });
      return;
    }
    solos.push(...members);
  });

  if (solos.length > 0) {
    groups.push({
      label: solos.length === 1 ? "Solo" : "Single stops",
      members: solos,
      spanM: 0,
    });
  }

  return groups;
}
