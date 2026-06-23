import type { Customer } from "../customers/customer-service";
import {
  namesAreDuplicateLike,
  nameSimilarityPercent,
  normalizeName,
} from "./name-fuzzy";

export type DuplicateCustomerLite = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
};

export type DuplicateGroupAiValidation = {
  isLikelyDuplicate: boolean;
  confidencePercent: number;
  summary: string;
  recommendedPrimaryId?: string;
};

export type DuplicateGroup = {
  customers: DuplicateCustomerLite[];
  reason: string;
  aiValidation?: DuplicateGroupAiValidation;
};

const MIN_PHONE_DIGITS = 7;
const MIN_ADDRESS_CHARS = 12;
const ADDRESS_MATCH_MIN_PERCENT = 85;
const LOCATION_MAX_METERS = 80;

function coerceString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return String(value);
}

function normalizePhoneKey(phone: unknown): string {
  const digits = coerceString(phone).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("63")) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    return digits.slice(1);
  }
  return digits;
}

function normalizeEmailKey(email: unknown): string {
  return coerceString(email).trim().toLowerCase();
}

function normalizeAddressKey(address: unknown): string {
  return coerceString(address)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addressSimilarityPercent(a: string, b: string): number {
  const na = normalizeAddressKey(a);
  const nb = normalizeAddressKey(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;

  const ta = new Set(na.split(" ").filter(Boolean));
  const tb = new Set(nb.split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;

  let intersection = 0;
  for (const token of ta) {
    if (tb.has(token)) intersection += 1;
  }
  const union = ta.size + tb.size - intersection;
  return union > 0 ? Math.round((intersection / union) * 100) : 0;
}

function resolveCoordinates(
  node: DuplicateCustomerLite,
): { lat: number; lng: number } | null {
  const lat = node.latitude;
  const lng = node.longitude;
  if (typeof lat === "number" && typeof lng === "number" &&
    Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }
  return null;
}

function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const r = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

function detectPairMatchLabels(
  a: DuplicateCustomerLite,
  b: DuplicateCustomerLite,
): string[] {
  const labels: string[] = [];

  const phoneA = normalizePhoneKey(a.phone || "");
  const phoneB = normalizePhoneKey(b.phone || "");
  if (phoneA.length >= MIN_PHONE_DIGITS && phoneA === phoneB) {
    labels.push("Same phone");
  }

  const emailA = a.email ? normalizeEmailKey(a.email) : "";
  const emailB = b.email ? normalizeEmailKey(b.email) : "";
  if (emailA && emailB && emailA === emailB) {
    labels.push("Same email");
  }

  const addressA = normalizeAddressKey(a.address || "");
  const addressB = normalizeAddressKey(b.address || "");
  if (addressA.length >= MIN_ADDRESS_CHARS && addressB.length >= MIN_ADDRESS_CHARS) {
    if (addressA.includes(addressB) || addressB.includes(addressA)) {
      labels.push("Same address");
    } else {
      const addressScore = addressSimilarityPercent(a.address || "", b.address || "");
      if (addressScore >= ADDRESS_MATCH_MIN_PERCENT) {
        labels.push(
          addressScore === 100 ? "Same address" : `Address ${addressScore}% match`,
        );
      }
    }
  }

  const pointA = resolveCoordinates(a);
  const pointB = resolveCoordinates(b);
  if (pointA && pointB) {
    const meters = haversineMeters(pointA, pointB);
    if (meters <= LOCATION_MAX_METERS) {
      labels.push(
        meters < 5 ? "Same map pin" : `Same location (~${Math.round(meters)}m)`,
      );
    }
  }

  if (namesAreDuplicateLike(a.name, b.name)) {
    labels.push(`Name ${nameSimilarityPercent(a.name, b.name)}% match`);
  }

  return labels;
}

function pairKey(idA: string, idB: string): string {
  return [idA, idB].sort().join("|");
}

function buildDuplicateGroupsUnionFind(
  nodes: DuplicateCustomerLite[],
): DuplicateGroup[] {
  const parent = new Map<string, string>();
  const pairLabels = new Map<string, string[]>();

  for (const node of nodes) {
    parent.set(node.id, node.id);
  }

  const find = (id: string): string => {
    const current = parent.get(id)!;
    if (current !== id) {
      parent.set(id, find(current));
    }
    return parent.get(id)!;
  };

  const union = (idA: string, idB: string) => {
    const rootA = find(idA);
    const rootB = find(idB);
    if (rootA !== rootB) {
      parent.set(rootA, rootB);
    }
  };

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const labels = detectPairMatchLabels(nodes[i], nodes[j]);
      if (labels.length === 0) continue;
      union(nodes[i].id, nodes[j].id);
      const key = pairKey(nodes[i].id, nodes[j].id);
      const existing = pairLabels.get(key) ?? [];
      pairLabels.set(key, [...new Set([...existing, ...labels])]);
    }
  }

  const buckets = new Map<string, DuplicateCustomerLite[]>();
  for (const node of nodes) {
    const root = find(node.id);
    const list = buckets.get(root) ?? [];
    list.push(node);
    buckets.set(root, list);
  }

  const groups: DuplicateGroup[] = [];
  for (const members of buckets.values()) {
    if (members.length < 2) continue;

    const labelSet = new Set<string>();
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const labels = pairLabels.get(pairKey(members[i].id, members[j].id));
        if (labels) {
          for (const label of labels) labelSet.add(label);
        }
      }
    }

    const matchLabels = [...labelSet].sort((a, b) => a.localeCompare(b));
    const nameHint = members.map((c) => `"${normalizeName(c.name)}"`).join(" · ");
    groups.push({
      customers: members,
      reason: matchLabels.length > 0 ?
        matchLabels.join(" · ") :
        `Similar names: ${nameHint}`,
    });
  }

  return groups.sort((a, b) => b.customers.length - a.customers.length);
}

/**
 * Duplicate clusters from phone, email, address, map pin, or fuzzy name match.
 */
export function detectDuplicateCustomerGroups(
  customers: Customer[],
): DuplicateGroup[] {
  const simplified: DuplicateCustomerLite[] = customers
    .filter((c) => c.id)
    .map((c) => ({
      id: c.id as string,
      name: coerceString(c.name) || "Unknown",
      phone: coerceString(c.phone),
      email: coerceString(c.email),
      address: coerceString(c.address),
      latitude: c.latitude,
      longitude: c.longitude,
    }));

  return buildDuplicateGroupsUnionFind(simplified);
}

export { validateDuplicateCustomerGroupsWithAi } from "./duplicate-customers-ai-validation-service";
