import type { Customer } from "../customers/customer-service";
import { namesAreDuplicateLike, normalizeName } from "./name-fuzzy";

export type DuplicateCustomerLite = {
  id: string;
  name: string;
  phone?: string;
  address?: string;
};

export type DuplicateGroup = {
  customers: DuplicateCustomerLite[];
  reason: string;
};

function buildDuplicateGroupsUnionFind(
  nodes: DuplicateCustomerLite[],
): DuplicateGroup[] {
  const parent = new Map<string, string>();
  for (const n of nodes) {
    parent.set(n.id, n.id);
  }
  const find = (x: string): string => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const p = parent.get(x)!;
    if (p !== x) {
      parent.set(x, find(p));
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return parent.get(x)!;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (namesAreDuplicateLike(nodes[i].name, nodes[j].name)) {
        union(nodes[i].id, nodes[j].id);
      }
    }
  }

  const buckets = new Map<string, DuplicateCustomerLite[]>();
  for (const n of nodes) {
    const r = find(n.id);
    const arr = buckets.get(r) || [];
    arr.push(n);
    buckets.set(r, arr);
  }

  const groups: DuplicateGroup[] = [];
  for (const members of buckets.values()) {
    if (members.length < 2) continue;
    groups.push({
      customers: members,
      reason: `Similar names: ${members.map((c) => `"${normalizeName(c.name)}"`).join(" · ")}`,
    });
  }
  return groups;
}

// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
/**
 * Typo-tolerant duplicate clusters (union-find), aligned with legacy "AI cleanup" UX.
 */
export function detectDuplicateCustomerGroups(
  customers: Customer[],
): DuplicateGroup[] {
  const simplified: DuplicateCustomerLite[] = customers
    .filter((c) => c.id)
    .map((c) => ({
      id: c.id as string,
      name: c.name || "Unknown",
      phone: c.phone || "",
      address: c.address || "",
    }));

  return buildDuplicateGroupsUnionFind(simplified);
}
