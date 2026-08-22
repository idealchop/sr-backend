import { Request, Response } from "express";
import { logger } from "firebase-functions";
import { checkBusinessAccess } from "../utils/auth-utils";
import { logAuditEvent } from "../services/observability/logging/logger";
import {
  ProductService,
  ProductValidationError,
} from "../services/products/product-service";

function canMutateProducts(role?: string): boolean {
  return role === "owner" || role === "admin";
}

export const listProducts = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;

  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const items = await ProductService.ensureSeeded(businessId);
    res.json({ data: items });
  } catch (error: any) {
    logger.error(`Error listing products for ${businessId}`, error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};

export const getProduct = async (req: Request, res: Response) => {
  const { businessId, productId } = req.params;
  const user = (req as any).user;

  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    await ProductService.ensureSeeded(businessId);
    const item = await ProductService.getItem(businessId, productId);
    if (!item) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    res.json({ data: item });
  } catch (error: any) {
    logger.error(`Error getting product ${productId}`, error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};

export const createProduct = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;

  try {
    const { hasAccess, role } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess || !canMutateProducts(role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const productId = await ProductService.createItem(businessId, req.body);
    logAuditEvent(
      "PRODUCT_CREATED",
      { businessId, userId: user.uid, productId },
      null,
      req.body,
    );
    res.status(201).json({ success: true, productId });
  } catch (error: any) {
    if (error instanceof ProductValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error(`Error creating product for ${businessId}`, error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};

export const updateProduct = async (req: Request, res: Response) => {
  const { businessId, productId } = req.params;
  const user = (req as any).user;

  try {
    const { hasAccess, role } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess || !canMutateProducts(role)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const before = await ProductService.getItem(businessId, productId);
    await ProductService.updateItem(businessId, productId, req.body);
    logAuditEvent(
      "PRODUCT_UPDATED",
      { businessId, userId: user.uid, productId },
      before,
      req.body,
    );
    res.json({ success: true });
  } catch (error: any) {
    if (error instanceof ProductValidationError) {
      const status = error.message === "Product not found." ? 404 : 400;
      res.status(status).json({ error: error.message });
      return;
    }
    logger.error(`Error updating product ${productId}`, error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};
