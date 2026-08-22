import { db } from "../../config/firebase-admin";
import {
  mergeProductIcons,
  SEEDED_PRODUCT_ICONS,
  type ProductIcon,
} from "./product-icon-catalog";

export function mapCmsProductIcon(
  id: string,
  data: Record<string, unknown>,
): ProductIcon {
  return {
    id,
    name: String(data.name || id),
    imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : undefined,
    lucide: typeof data.lucide === "string" ? data.lucide : undefined,
    sortOrder: Number(data.sortOrder) || 99,
    active: data.active !== false,
  };
}

export async function loadMergedProductIcons(): Promise<ProductIcon[]> {
  try {
    const snap = await db.collection("product_icons").get();
    const cms = snap.docs.map((doc) =>
      mapCmsProductIcon(doc.id, doc.data() as Record<string, unknown>),
    );
    return mergeProductIcons(cms);
  } catch {
    return SEEDED_PRODUCT_ICONS.filter((icon) => icon.active);
  }
}
