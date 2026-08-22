import { Request, Response } from "express";
import { logger } from "firebase-functions";
import { loadMergedProductIcons } from "../services/products/product-icon-service";
import { SEEDED_PRODUCT_ICONS } from "../services/products/product-icon-catalog";

export const getPublicProductIcons = async (_req: Request, res: Response) => {
  try {
    const icons = await loadMergedProductIcons();
    res.json({ data: icons });
  } catch (error) {
    logger.warn("product_icons catalog read failed; using seeded defaults", { error });
    res.json({ data: SEEDED_PRODUCT_ICONS.filter((icon) => icon.active) });
  }
};
