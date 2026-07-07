import { Request, Response } from "express";
import { logger } from "firebase-functions";
import { InventoryService } from "../services/inventory/inventory-service";
import { getInventoryItemStockHistory } from "../services/inventory/inventory-stock-history";
import { checkBusinessAccess } from "../utils/auth-utils";
import { logAuditEvent } from "../services/observability/logging/logger";
import {
  notifyInventoryItemCreated,
  notifyInventoryItemDeleted,
  notifyInventoryItemUpdated,
  notifyInventoryStockAdjusted,
} from "../services/notifications/station-activity-notification-service";

function summarizeInventoryUpdate(
  before: Awaited<ReturnType<typeof InventoryService.getItem>>,
  data: Record<string, unknown>,
): string | undefined {
  const parts: string[] = [];
  if (typeof data.name === "string" && data.name.trim() && data.name !== before?.name) {
    parts.push("name");
  }
  if (data.cost !== undefined && data.cost !== before?.cost) {
    parts.push("price");
  }
  if (data.inventoryRole !== undefined && data.inventoryRole !== before?.inventoryRole) {
    parts.push("catalog role");
  }
  if (data.stock && typeof data.stock === "object") {
    const stock = data.stock as { min?: number };
    if (stock.min !== undefined && stock.min !== before?.stock?.min) {
      parts.push("low-stock alert");
    }
  }
  if (Array.isArray(data.kitComponentIds)) {
    parts.push("kit parts");
  }
  if (parts.length === 0) return undefined;
  return parts.join(", ");
}

export const listInventory = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;

  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const items = await InventoryService.listItems(businessId);
    res.json({ data: items });
  } catch (error: any) {
    logger.error(`Error listing inventory for ${businessId}`, error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};

export const getInventoryItem = async (req: Request, res: Response) => {
  const { businessId, itemId } = req.params;
  const user = (req as any).user;

  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const item = await InventoryService.getItem(businessId, itemId);
    if (!item) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    res.json(item);
  } catch (error: any) {
    logger.error(`Error getting inventory item ${itemId}`, error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};

export const createInventoryItem = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;
  const data = req.body;

  try {
    const { hasAccess, role } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess || role === "member") {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const itemId = await InventoryService.createItem(businessId, data);

    logAuditEvent(
      "INVENTORY_ITEM_CREATED",
      {
        businessId,
        userId: user.uid,
        itemId,
      },
      null,
      data,
    );

    const itemName = String(data?.name || "Stock item");
    const startingStock = Number(data?.stock?.current) || 0;
    const unit = String(data?.stock?.unit || "units");
    void notifyInventoryItemCreated(
      businessId,
      itemName,
      startingStock,
      unit,
      user.uid,
      itemId,
    ).catch((err) => logger.warn("notifyInventoryItemCreated failed", err));

    res.status(201).json({ success: true, itemId });
  } catch (error: any) {
    logger.error(`Error creating inventory item for ${businessId}`, error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};

export const updateInventoryItem = async (req: Request, res: Response) => {
  const { businessId, itemId } = req.params;
  const user = (req as any).user;
  const data = req.body;

  try {
    const { hasAccess, role } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess || role === "member") {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const before = await InventoryService.getItem(businessId, itemId);
    await InventoryService.updateItem(businessId, itemId, data);

    logAuditEvent(
      "INVENTORY_ITEM_UPDATED",
      {
        businessId,
        userId: user.uid,
        itemId,
      },
      null,
      data,
    );

    const itemName = String(data?.name || before?.name || "Stock item");
    const summary = summarizeInventoryUpdate(before, data);
    void notifyInventoryItemUpdated(
      businessId,
      itemName,
      user.uid,
      itemId,
      summary,
    ).catch((err) => logger.warn("notifyInventoryItemUpdated failed", err));

    res.json({ success: true });
  } catch (error: any) {
    logger.error(`Error updating inventory item ${itemId}`, error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};

export const deleteInventoryItem = async (req: Request, res: Response) => {
  const { businessId, itemId } = req.params;
  const user = (req as any).user;

  try {
    const { hasAccess, role } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess || role === "member") {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const item = await InventoryService.getItem(businessId, itemId);
    await InventoryService.deleteItem(businessId, itemId);

    logAuditEvent("INVENTORY_ITEM_DELETED", {
      businessId,
      userId: user.uid,
      itemId,
    });

    if (item?.name) {
      void notifyInventoryItemDeleted(
        businessId,
        item.name,
        user.uid,
        itemId,
      ).catch((err) => logger.warn("notifyInventoryItemDeleted failed", err));
    }

    res.json({ success: true });
  } catch (error: any) {
    logger.error(`Error deleting inventory item ${itemId}`, error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};

export const adjustStock = async (req: Request, res: Response) => {
  const { businessId, itemId } = req.params;
  const { amount, reason } = req.body;
  const user = (req as any).user;

  if (typeof amount !== "number") {
    res.status(400).json({ error: "Amount must be a number" });
    return;
  }

  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const item = await InventoryService.getItem(businessId, itemId);
    const newStock = await InventoryService.adjustStock(
      businessId,
      itemId,
      amount,
      {
        userId: user.uid,
        reason: reason || "MANUAL_RESTOCK",
        type: "manual",
      },
    );

    logAuditEvent("INVENTORY_STOCK_ADJUSTED", {
      businessId,
      userId: user.uid,
      itemId,
      adjustment: amount,
      newStock,
      reason: reason || "MANUAL_RESTOCK",
    });

    if (item?.name) {
      void notifyInventoryStockAdjusted(
        businessId,
        item.name,
        amount,
        newStock,
        item.stock?.unit || "units",
        user.uid,
        itemId,
      ).catch((err) => logger.warn("notifyInventoryStockAdjusted failed", err));
    }

    res.json({ success: true, newStock });
  } catch (error: any) {
    logger.error(`Error adjusting stock for item ${itemId}`, error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};

export const getCustomerAssignments = async (req: Request, res: Response) => {
  const { businessId, customerId } = req.params;
  const user = (req as any).user;

  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const assignments = await InventoryService.getCustomerAssignments(
      businessId,
      customerId,
    );
    res.json({ data: assignments });
  } catch (error: any) {
    logger.error(
      `Error fetching assignments for customer ${customerId}`,
      error,
    );
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};

export const getItemStockHistory = async (req: Request, res: Response) => {
  const { businessId, itemId } = req.params;
  const user = (req as any).user;
  const limit = Math.min(
    parseInt(String(req.query.limit || "50"), 10) || 50,
    100,
  );

  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const data = await getInventoryItemStockHistory(
      businessId,
      itemId,
      limit,
    );
    res.json({ data });
  } catch (error: any) {
    logger.error(`Error fetching stock history for item ${itemId}`, error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};

export const getItemAssignments = async (req: Request, res: Response) => {
  const { businessId, itemId } = req.params;
  const user = (req as any).user;

  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const assignments = await InventoryService.getItemAssignments(
      businessId,
      itemId,
    );
    res.json({ data: assignments });
  } catch (error: any) {
    logger.error(`Error fetching assignments for item ${itemId}`, error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};

export const assignToHub = async (req: Request, res: Response) => {
  const { businessId, itemId } = req.params;
  const { hubId, hubName, quantity, type } = req.body;
  const user = (req as any).user;

  if (typeof quantity !== "number" || quantity <= 0) {
    res.status(400).json({ error: "Quantity must be a positive number" });
    return;
  }

  if (!hubId || !hubName) {
    res.status(400).json({ error: "Hub ID and Hub Name are required" });
    return;
  }

  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    await InventoryService.assignToHub(businessId, itemId, {
      hubId,
      hubName,
      quantity,
      type,
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error(`Error assigning item ${itemId} to hub ${hubId}`, error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};

export const returnFromHub = async (req: Request, res: Response) => {
  const { businessId, itemId } = req.params;
  const { hubId, quantity } = req.body;
  const user = (req as any).user;

  if (typeof quantity !== "number" || quantity <= 0) {
    res.status(400).json({ error: "Quantity must be a positive number" });
    return;
  }

  if (!hubId) {
    res.status(400).json({ error: "Hub ID is required" });
    return;
  }

  try {
    const { hasAccess } = await checkBusinessAccess(user.uid, businessId);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    await InventoryService.returnFromHub(businessId, itemId, {
      hubId,
      quantity,
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error(`Error returning item ${itemId} from hub ${hubId}`, error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
};
