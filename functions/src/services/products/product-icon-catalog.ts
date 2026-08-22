export type ProductIcon = {
  id: string;
  name: string;
  imageUrl?: string;
  lucide?: string;
  sortOrder: number;
  active: boolean;
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
  },
  {
    id: "slim-gallon",
    name: "Slim gallon",
    imageUrl: SLIM_GALLON_URL,
    sortOrder: 2,
    active: true,
  },
];

export function isSalesPortalProductIcon(icon: Pick<ProductIcon, "imageUrl">): boolean {
  return Boolean(icon.imageUrl?.trim());
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
    });
  }

  const portal = cms.filter(isSalesPortalProductIcon);
  const source = portal.length > 0 ? portal : SEEDED_PRODUCT_ICONS.filter(
    (icon) => icon.active && isSalesPortalProductIcon(icon),
  );

  return source.slice().sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
}

export function iconUrlForId(
  icons: ProductIcon[],
  iconId: string | undefined,
): string | undefined {
  if (!iconId) return undefined;
  return icons.find((icon) => icon.id === iconId)?.imageUrl;
}
