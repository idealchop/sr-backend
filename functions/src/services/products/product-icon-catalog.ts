export type ProductIcon = {
  id: string;
  name: string;
  imageUrl?: string;
  lucide?: string;
  sortOrder: number;
  active: boolean;
  /** Gallon, bottle, or other refill container (not a store accessory). */
  waterContainer?: boolean;
};

const ROUND_GALLON_URL =
  "https://firebasestorage.googleapis.com/v0/b/smartrefill-singapore/o/gallons-icons%2FRound.svg?alt=media&token=6407f29e-e408-4b66-b9e1-d7998aa9670d";
const SLIM_GALLON_URL =
  "https://firebasestorage.googleapis.com/v0/b/smartrefill-singapore/o/gallons-icons%2FSlim.svg?alt=media&token=fce7d239-7eda-4e37-8b9d-183e232f5b93";

/** Fallback when a product has no icon, or Sales Portal CMS is empty. */
export const DEFAULT_PRODUCT_ICON_ID = "round-gallon";

/** Seeded gallon images used only when Sales Portal `product_icons` has no image rows. */
export const SEEDED_PRODUCT_ICONS: ProductIcon[] = [
  {
    id: "round-gallon",
    name: "Round gallon",
    imageUrl: ROUND_GALLON_URL,
    sortOrder: 1,
    active: true,
    waterContainer: true,
  },
  {
    id: "slim-gallon",
    name: "Slim gallon",
    imageUrl: SLIM_GALLON_URL,
    sortOrder: 2,
    active: true,
    waterContainer: true,
  },
];

export type CanonicalGallonIconId = "round-gallon" | "slim-gallon";

const GALLON_ICON_ALIAS_IDS: Record<string, CanonicalGallonIconId> = {
  roundgallon: "round-gallon",
  roundicon: "round-gallon",
  slimgallon: "slim-gallon",
  slimicon: "slim-gallon",
};

function compactIconKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function inferGallonProductIconId(name?: string | null): CanonicalGallonIconId | undefined {
  if (!name) return undefined;
  const key = name.trim().toLowerCase();
  if (/\bslim\b/.test(key) || key.includes("slim-gallon")) return "slim-gallon";
  if (/\bround\b/.test(key) || key.includes("round-gallon")) return "round-gallon";
  return undefined;
}

export function canonicalGallonIconId(
  id?: string | null,
  name?: string | null,
  imageUrl?: string | null,
): CanonicalGallonIconId | undefined {
  const compactId = compactIconKey(id || "");
  if (compactId && GALLON_ICON_ALIAS_IDS[compactId]) {
    return GALLON_ICON_ALIAS_IDS[compactId];
  }
  const url = (imageUrl || "").toLowerCase();
  if (/(?:\/|%2f)slim\.svg/.test(url)) return "slim-gallon";
  if (/(?:\/|%2f)round\.svg/.test(url)) return "round-gallon";
  return inferGallonProductIconId(name) ?? inferGallonProductIconId(id);
}

function seededGallonIcon(id: CanonicalGallonIconId): ProductIcon {
  return SEEDED_PRODUCT_ICONS.find((icon) => icon.id === id) ?? SEEDED_PRODUCT_ICONS[0];
}

function collapseGallonDuplicates(icons: ProductIcon[]): ProductIcon[] {
  const seen = new Set<CanonicalGallonIconId>();
  const next: ProductIcon[] = [];
  for (const icon of icons) {
    const canonical = canonicalGallonIconId(icon.id, icon.name, icon.imageUrl);
    if (!canonical) {
      next.push(icon);
      continue;
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const seeded = seededGallonIcon(canonical);
    next.push({
      ...icon,
      id: canonical,
      name: seeded.name,
      imageUrl: icon.imageUrl || seeded.imageUrl,
      waterContainer: true,
      sortOrder: seeded.sortOrder,
    });
  }
  return next;
}

/** Sales Portal `product_icons` are image assets — Lucide placeholders are not in that catalog. */
export function isSalesPortalProductIcon(icon: Pick<ProductIcon, "imageUrl">): boolean {
  return Boolean(icon.imageUrl?.trim());
}

export function isWaterContainerProductIcon(
  icon: Pick<ProductIcon, "waterContainer">,
): boolean {
  return icon.waterContainer === true;
}

export function mergeProductIcons(cmsRows: ProductIcon[]): ProductIcon[] {
  const cms: ProductIcon[] = [];
  for (const icon of cmsRows) {
    const id = String(icon.id || "").trim();
    if (!id || icon.active === false) continue;
    cms.push({
      id,
      name: String(icon.name || id).trim() || id,
      imageUrl: icon.imageUrl,
      lucide: icon.lucide,
      sortOrder: Number.isFinite(Number(icon.sortOrder)) ? Number(icon.sortOrder) : 99,
      active: true,
      waterContainer: icon.waterContainer === true,
    });
  }

  const portal = cms.filter(isSalesPortalProductIcon);
  const source = portal.length > 0 ? portal : SEEDED_PRODUCT_ICONS.filter(
    (icon) => icon.active && isSalesPortalProductIcon(icon),
  );

  return collapseGallonDuplicates(source).sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
}

export function iconUrlForId(
  icons: ProductIcon[],
  iconId: string | undefined,
): string | undefined {
  if (!iconId) return undefined;
  const direct = icons.find((icon) => icon.id === iconId)?.imageUrl;
  if (direct) return direct;
  const canonical = canonicalGallonIconId(iconId);
  if (!canonical || canonical === iconId) return undefined;
  return icons.find((icon) => icon.id === canonical)?.imageUrl;
}
