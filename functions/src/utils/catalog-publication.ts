/**
 * Catalog draft/publish rules shared by SmartRefill reads.
 * Missing `catalogStatus` is treated as published (legacy rows).
 */

export type CatalogStatus = "draft" | "published";

export const VERSIONED_CATALOG_COLLECTIONS = [
  "subscription_plans",
  "subscription_trial_policy",
] as const;

export type VersionedCatalogCollectionId =
  (typeof VERSIONED_CATALOG_COLLECTIONS)[number];

export function isVersionedCatalogCollection(
  collectionId: string,
): collectionId is VersionedCatalogCollectionId {
  return (VERSIONED_CATALOG_COLLECTIONS as readonly string[]).includes(
    collectionId,
  );
}

export function parseCatalogDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "object") {
    const record = value as {
      toDate?: () => Date;
      _seconds?: number;
      seconds?: number;
    };
    if (typeof record.toDate === "function") {
      const date = record.toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const seconds = record._seconds ?? record.seconds;
    if (typeof seconds === "number" && Number.isFinite(seconds)) {
      return new Date(seconds * 1000);
    }
  }
  return null;
}

/** Next Asia/Manila midnight from `from`. */
export function nextManilaMidnight(from = new Date()): Date {
  const manilaMs = from.getTime() + 8 * 60 * 60 * 1000;
  const manila = new Date(manilaMs);
  const nextUtc = Date.UTC(
    manila.getUTCFullYear(),
    manila.getUTCMonth(),
    manila.getUTCDate() + 1,
    0,
    0,
    0,
  );
  return new Date(nextUtc - 8 * 60 * 60 * 1000);
}

export function catalogStatusOf(data: Record<string, unknown> | null | undefined): CatalogStatus {
  const status = String(data?.catalogStatus || "published").toLowerCase();
  return status === "draft" ? "draft" : "published";
}

/**
 * Whether a catalog document may be sold / shown to new stations right now.
 * Inactive and unpublished / not-yet-effective rows are hidden from checkout.
 */
export function isCatalogLiveForNewSales(
  data: Record<string, unknown> | null | undefined,
  now = new Date(),
): boolean {
  if (!data) return false;
  if (data.isActive === false) return false;
  if (catalogStatusOf(data) !== "published") return false;
  const effectiveAt = parseCatalogDate(data.effectiveAt);
  if (effectiveAt && effectiveAt.getTime() > now.getTime()) return false;
  return true;
}

export function hasPendingCatalogDraft(
  data: Record<string, unknown> | null | undefined,
): boolean {
  const draft = data?.draft;
  return Boolean(draft && typeof draft === "object" && !Array.isArray(draft));
}
