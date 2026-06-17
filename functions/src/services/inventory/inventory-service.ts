import {
  QueryDocumentSnapshot,
  Transaction,
  DocumentReference,
} from "firebase-admin/firestore";
import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";

export interface InventoryItem {
  id?: string;
  name: string;
  categoryId: string;
  stock: {
    current: number;
    min: number;
    unit?: string;
    lowStockThreshold?: number;
    possessions?: Record<
      string,
      {
        name: string;
        quantity: number;
        updatedAt?: any;
      }
    >;
  };
  cost: number;
  imageUrl?: string;
  avgUsage?: number;
  createdAt?: any;
  updatedAt?: any;
}

export interface InventoryAssignment {
  id?: string;
  inventoryItemId: string;
  inventoryItemName: string;
  customerId: string;
  customerName: string;
  quantityAssigned: number;
  date: any; // Firestore Timestamp
  transactionId?: string;
}

export class InsufficientStockError extends Error {
  constructor(
    public items: {
      id: string;
      name: string;
      available: number;
      requested: number;
    }[],
  ) {
    super("Insufficient stock for one or more items");
    this.name = "InsufficientStockError";
  }
}

/**
 * Result of applying merged stock deltas inside a Firestore transaction
 * (for audit after commit).
 */
export type StockDeltaApplyResult = {
  itemId: string;
  netDelta: number;
  previousStock: number;
  newStock: number;
  name?: string;
};

/**
 * Service for managing inventory items within a business.
 */
export class InventoryService {
  /**
   * Lists all inventory items for a business.
   * @param {string} businessId The business ID.
   * @return {Promise<InventoryItem[]>}
   */
  static async listItems(businessId: string): Promise<InventoryItem[]> {
    try {
      const snapshot = await db
        .collection("businesses")
        .doc(businessId)
        .collection("inventory_items")
        .orderBy("createdAt", "desc")
        .get();

      return snapshot.docs.map((doc: QueryDocumentSnapshot) => {
        const data = doc.data();
        return {
          ...data,
          id: doc.id,
        } as InventoryItem;
      });
    } catch (error) {
      logger.error(`Failed to list inventory for business ${businessId}`, {
        error,
      });
      throw error;
    }
  }

  /**
   * Retrieves a single inventory item.
   * @param {string} businessId The business ID.
   * @param {string} itemId The item ID.
   * @return {Promise<InventoryItem | null>}
   */
  static async getItem(
    businessId: string,
    itemId: string,
  ): Promise<InventoryItem | null> {
    try {
      const doc = await db
        .collection("businesses")
        .doc(businessId)
        .collection("inventory_items")
        .doc(itemId)
        .get();

      if (!doc.exists) return null;
      return { id: doc.id, ...doc.data() } as InventoryItem;
    } catch (error) {
      logger.error(`Failed to get inventory item ${itemId}`, { error });
      throw error;
    }
  }

  /**
   * Creates a new inventory item.
   * @param {string} businessId The business ID.
   * @param {Partial<InventoryItem>} data The item data.
   * @return {Promise<string>} The created item ID.
   */
  static async createItem(
    businessId: string,
    data: Partial<InventoryItem>,
  ): Promise<string> {
    try {
      const itemRef = data.id ?
        db
          .collection("businesses")
          .doc(businessId)
          .collection("inventory_items")
          .doc(data.id) :
        db
          .collection("businesses")
          .doc(businessId)
          .collection("inventory_items")
          .doc();

      const saveData = { ...data };
      delete saveData.id;
      const newItem = {
        ...saveData,
        id: itemRef.id, // Store the doc id inside the document as well
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      await itemRef.set(newItem);
      return itemRef.id;
    } catch (error) {
      logger.error(
        `Failed to create inventory item for business ${businessId}`,
        { error },
      );
      throw error;
    }
  }

  /**
   * Updates an existing inventory item.
   * @param {string} businessId The business ID.
   * @param {string} itemId The item ID.
   * @param {Partial<InventoryItem>} data The update data.
   * @return {Promise<void>}
   */
  static async updateItem(
    businessId: string,
    itemId: string,
    data: Partial<InventoryItem>,
  ): Promise<void> {
    try {
      logger.info(
        `InventoryService.updateItem: Updating item ${itemId} ` +
          `for business ${businessId}`,
      );
      const itemRef = db
        .collection("businesses")
        .doc(businessId)
        .collection("inventory_items")
        .doc(itemId);

      const saveData = { ...data };
      delete saveData.id;
      const updateData = {
        ...saveData,
        id: itemId, // Ensure internal id matches the doc id
        updatedAt: FieldValue.serverTimestamp(),
      };

      await itemRef.set(updateData, { merge: true });
      logger.info(
        `InventoryService.updateItem: Successfully updated item ${itemId}`,
      );
    } catch (error) {
      logger.error(`Failed to update inventory item ${itemId}`, { error });
      throw error;
    }
  }

  /**
   * Deletes an inventory item.
   * @param {string} businessId The business ID.
   * @param {string} itemId The item ID.
   * @return {Promise<void>}
   */
  static async deleteItem(businessId: string, itemId: string): Promise<void> {
    try {
      await db
        .collection("businesses")
        .doc(businessId)
        .collection("inventory_items")
        .doc(itemId)
        .delete();
    } catch (error) {
      logger.error(`Failed to delete inventory item ${itemId}`, { error });
      throw error;
    }
  }

  /**
   * Applies merged stock deltas in one Firestore transaction pass: all document reads first,
   * then all writes. Required because Firestore forbids reads after any write in the same
   * transaction.
   * @param {Transaction} transaction The Firestore transaction object.
   * @param {string} businessId The business ID.
   * @param {Map<string, number>} deltasByItemId Inventory item id -> net delta
   * (sum of adjustments).
   * @return {Promise<StockDeltaApplyResult[]>} Per-item before/after for audit logging
   * after commit.
   */
  static async applyStockDeltasInTransaction(
    transaction: Transaction,
    businessId: string,
    deltasByItemId: Map<string, number>,
  ): Promise<StockDeltaApplyResult[]> {
    const entries = [...deltasByItemId.entries()].filter(
      ([, delta]) => delta !== 0,
    );
    if (entries.length === 0) {
      return [];
    }

    const refs = entries.map(([itemId]) =>
      db
        .collection("businesses")
        .doc(businessId)
        .collection("inventory_items")
        .doc(itemId),
    );

    const snaps = await Promise.all(refs.map((ref) => transaction.get(ref)));

    const pendingWrites: Array<{
      ref: DocumentReference;
      itemId: string;
      netDelta: number;
      previousStock: number;
      newStock: number;
      name?: string;
    }> = [];

    for (let i = 0; i < entries.length; i++) {
      const [itemId, netDelta] = entries[i];
      const itemDoc = snaps[i];
      if (!itemDoc.exists) {
        throw new Error(`Item ${itemId} not found`);
      }
      const itemData = itemDoc.data();
      const currentStock = itemData?.stock?.current || 0;
      const newStock = currentStock + netDelta;

      if (netDelta < 0 && newStock < 0) {
        throw new InsufficientStockError([
          {
            id: itemId,
            name: itemData?.name || "Unknown Item",
            available: currentStock,
            requested: Math.abs(netDelta),
          },
        ]);
      }

      pendingWrites.push({
        ref: refs[i],
        itemId,
        netDelta,
        previousStock: currentStock,
        newStock,
        name: itemData?.name,
      });
    }

    for (const w of pendingWrites) {
      transaction.update(w.ref, {
        "stock.current": w.newStock,
        "updatedAt": FieldValue.serverTimestamp(),
      });
    }

    return pendingWrites.map((w) => ({
      itemId: w.itemId,
      netDelta: w.netDelta,
      previousStock: w.previousStock,
      newStock: w.newStock,
      name: w.name,
    }));
  }

  /**
   * Adjusts the stock level of an item within an existing Firestore transaction.
   * @param {Transaction} transaction The Firestore transaction object.
   * @param {string} businessId The business ID.
   * @param {string} itemId The item ID.
   * @param {number} amount The amount to adjust by (positive or negative).
   * @param {Record<string, any>} context Context for the adjustment.
   */
  static async adjustStockWithTransaction(
    transaction: Transaction,
    businessId: string,
    itemId: string,
    amount: number,
    context: Record<string, any> = {},
  ): Promise<void> {
    const [row] = await InventoryService.applyStockDeltasInTransaction(
      transaction,
      businessId,
      new Map([[itemId, amount]]),
    );
    if (!row) {
      return;
    }

    const { logAuditEvent } = await import("../observability/logging/logger");

    await logAuditEvent(
      "INVENTORY_ADJUSTED",
      {
        businessId,
        itemId,
        itemName: row.name,
        adjustment: amount,
        ...context,
      },
      { currentStock: row.previousStock },
      { currentStock: row.newStock },
    );
  }

  /**
   * Adjusts the stock level of an item and logs the change.
   * @param {string} businessId The business ID.
   * @param {string} itemId The item ID.
   * @param {number} amount The amount to adjust by (positive or negative).
   * @param {Record<string, any>} context Context for the adjustment (e.g. { customerId, userId }).
   * @return {Promise<number>} The new stock level.
   */
  static async adjustStock(
    businessId: string,
    itemId: string,
    amount: number,
    context: Record<string, any> = {},
  ): Promise<number> {
    try {
      const res = await db.runTransaction(async (transaction: Transaction) => {
        const itemRef = db
          .collection("businesses")
          .doc(businessId)
          .collection("inventory_items")
          .doc(itemId);

        const itemDoc = await transaction.get(itemRef);
        if (!itemDoc.exists) throw new Error("Item not found");

        const itemData = itemDoc.data();
        const currentStock = itemData?.stock?.current || 0;
        const newStock = currentStock + amount;

        // HARD STOP: Stock cannot be negative if it's a reduction
        if (amount < 0 && newStock < 0) {
          throw new InsufficientStockError([
            {
              id: itemId,
              name: itemData?.name || "Unknown Item",
              available: currentStock,
              requested: Math.abs(amount),
            },
          ]);
        }

        transaction.update(itemRef, {
          "stock.current": newStock,
          "updatedAt": FieldValue.serverTimestamp(),
        });

        return {
          newStock,
          currentStock,
          itemName: itemData?.name as string | undefined,
        };
      });

      const { logAuditEvent } =
        await import("../observability/logging/logger");

      await logAuditEvent(
        "INVENTORY_ADJUSTED",
        {
          businessId,
          itemId,
          itemName: res.itemName,
          adjustment: amount,
          ...context,
        },
        { currentStock: res.currentStock },
        { currentStock: res.newStock },
      );

      // AFTER TRANSACTION: Check for low stock alerts
      try {
        const itemRef = db
          .collection("businesses")
          .doc(businessId)
          .collection("inventory_items")
          .doc(itemId);
        const itemSnap = await itemRef.get();
        if (itemSnap.exists) {
          const item = { ...itemSnap.data(), id: itemSnap.id } as InventoryItem;
          await InventoryService.checkLowStockAndNotify(businessId, item);
        }
      } catch (err) {
        logger.error(`Failed to check low stock for item ${itemId}`, err);
      }

      return res.newStock;
    } catch (error) {
      logger.error(`Failed to adjust stock for item ${itemId}`, { error });
      throw error;
    }
  }

  /**
   * Checks if an item's stock is below the threshold and sends a notification if so.
   * @param {string} businessId The business ID.
   * @param {InventoryItem} item The inventory item.
   */
  static async checkLowStockAndNotify(
    businessId: string,
    item: InventoryItem,
  ): Promise<void> {
    const currentStock = item.stock.current;
    // Use lowStockThreshold if defined, otherwise fall back to min
    const threshold =
      item.stock.lowStockThreshold !== undefined ?
        item.stock.lowStockThreshold :
        item.stock.min || 0;

    if (currentStock <= threshold) {
      try {
        const { notifyInventoryLowStock } =
          await import("../notifications/station-activity-notification-service");
        await notifyInventoryLowStock(
          businessId,
          item.name,
          currentStock,
          item.stock.unit || "units",
          item.id,
        );
        logger.info(
          `Low stock alert triggered for ${item.name} in business ${businessId}`,
        );
      } catch (error) {
        logger.error(
          `Failed to send low stock notification for ${item.name}`,
          error,
        );
      }
    }
  }

  /**
   * Records an inventory assignment for a customer.
   * @param {string} businessId The business ID.
   * @param {InventoryAssignment} assignment The assignment data.
   * @param {Transaction} transaction Optional Firestore transaction.
   */
  static async createAssignment(
    businessId: string,
    assignment: InventoryAssignment,
    transaction?: Transaction,
  ): Promise<void> {
    try {
      const assignmentRef = db
        .collection("businesses")
        .doc(businessId)
        .collection("inventory_assignments")
        .doc();

      const data = {
        ...assignment,
        id: assignmentRef.id,
        createdAt: FieldValue.serverTimestamp(),
      };

      if (transaction) {
        transaction.set(assignmentRef, data);
      } else {
        await assignmentRef.set(data);
      }
    } catch (error) {
      logger.error(
        `Failed to create inventory assignment for business ${businessId}`,
        { error },
      );
      throw error;
    }
  }

  /**
   * Lists inventory assignment events for a specific item (e.g. customer assets).
   * @param {string} businessId The business ID.
   * @param {string} inventoryItemId The inventory item ID.
   * @param {number} limit Maximum number of rows to return.
   * @return {Promise<InventoryAssignment[]>}
   */
  static async getItemAssignments(
    businessId: string,
    inventoryItemId: string,
    limit = 50,
  ): Promise<InventoryAssignment[]> {
    try {
      const snapshot = await db
        .collection("businesses")
        .doc(businessId)
        .collection("inventory_assignments")
        .where("inventoryItemId", "==", inventoryItemId)
        .orderBy("date", "desc")
        .limit(limit)
        .get();

      return snapshot.docs.map(
        (doc: QueryDocumentSnapshot) =>
          ({
            ...doc.data(),
            id: doc.id,
          }) as InventoryAssignment,
      );
    } catch (error) {
      logger.error(
        `Failed to fetch assignments for item ${inventoryItemId}`,
        { error },
      );
      throw error;
    }
  }

  /**
   * Lists inventory assignments for a specific customer.
   * @param {string} businessId The business ID.
   * @param {string} customerId The customer ID.
   * @return {Promise<InventoryAssignment[]>}
   */
  static async getCustomerAssignments(
    businessId: string,
    customerId: string,
  ): Promise<InventoryAssignment[]> {
    try {
      const snapshot = await db
        .collection("businesses")
        .doc(businessId)
        .collection("inventory_assignments")
        .where("customerId", "==", customerId)
        .orderBy("date", "desc")
        .limit(50)
        .get();

      return snapshot.docs.map(
        (doc: QueryDocumentSnapshot) =>
          ({
            ...doc.data(),
            id: doc.id,
          }) as InventoryAssignment,
      );
    } catch (error) {
      logger.error(`Failed to fetch assignments for customer ${customerId}`, {
        error,
      });
      throw error;
    }
  }

  /**
   * Assigns stock to a hub (rider or location).
   * @param {string} businessId The business ID.
   * @param {string} itemId The item ID.
   * @param {Object} params Hub assignment parameters.
   */
  static async assignToHub(
    businessId: string,
    itemId: string,
    params: {
      hubId: string;
      hubName: string;
      quantity: number;
      type: "rider" | "location";
    },
  ): Promise<void> {
    const { hubId, quantity } = params;
    try {
      await db.runTransaction(async (transaction: Transaction) => {
        const itemRef = db
          .collection("businesses")
          .doc(businessId)
          .collection("inventory_items")
          .doc(itemId);

        const itemDoc = await transaction.get(itemRef);
        if (!itemDoc.exists) throw new Error("Item not found");

        const itemData = itemDoc.data() as InventoryItem;
        const currentStock = itemData.stock?.current || 0;

        if (currentStock < quantity) {
          throw new Error(
            `Insufficient stock. Available: ${currentStock}, Requested: ${quantity}`,
          );
        }

        const currentHubData = itemData.stock?.possessions?.[hubId] as
          | { name: string; quantity: number }
          | undefined;
        const currentHubStock = currentHubData?.quantity || 0;
        const newHubStock = currentHubStock + quantity;
        const newStationStock = currentStock - quantity;

        transaction.update(itemRef, {
          "stock.current": newStationStock,
          [`stock.possessions.${hubId}`]: {
            name: params.hubName,
            quantity: newHubStock,
            updatedAt: FieldValue.serverTimestamp(),
          },
          "updatedAt": FieldValue.serverTimestamp(),
        });

        // Log the assignment
        const { logAuditEvent } =
          await import("../observability/logging/logger");
        await logAuditEvent(
          "INVENTORY_ASSIGNED_TO_HUB",
          {
            businessId,
            itemId,
            itemName: itemData.name,
            hubId,
            hubName: params.hubName,
            hubType: params.type,
            quantity,
          },
          { currentStock, hubStock: currentHubStock },
          { currentStock: newStationStock, hubStock: newHubStock },
        );
      });
    } catch (error) {
      logger.error(`Failed to assign item ${itemId} to hub ${hubId}`, {
        error,
      });
      throw error;
    }
  }
  /**
   * Returns stock from a hub to the main station.
   * @param {string} businessId The business ID.
   * @param {string} itemId The item ID.
   * @param {Object} params Return parameters.
   */
  static async returnFromHub(
    businessId: string,
    itemId: string,
    params: { hubId: string; quantity: number },
  ): Promise<void> {
    const { hubId, quantity } = params;
    try {
      await db.runTransaction(async (transaction: Transaction) => {
        const itemRef = db
          .collection("businesses")
          .doc(businessId)
          .collection("inventory_items")
          .doc(itemId);

        const itemDoc = await transaction.get(itemRef);
        if (!itemDoc.exists) throw new Error("Item not found");

        const itemData = itemDoc.data() as InventoryItem;
        const currentStationStock = itemData.stock?.current || 0;
        const possessions = itemData.stock?.possessions || {};
        const hubData = possessions[hubId];

        if (
          !hubData ||
          (typeof hubData === "number" ? hubData : hubData.quantity) < quantity
        ) {
          throw new Error(
            `Insufficient stock in hub. Available: ${typeof hubData === "number" ? hubData :
              hubData?.quantity || 0}, Requested: ${quantity}`,
          );
        }

        const currentHubStock =
          typeof hubData === "number" ? hubData : hubData.quantity;
        const newHubStock = currentHubStock - quantity;
        const newStationStock = currentStationStock + quantity;

        const updateData: any = {
          "stock.current": newStationStock,
          "updatedAt": FieldValue.serverTimestamp(),
        };

        if (newHubStock === 0) {
          updateData[`stock.possessions.${hubId}`] = FieldValue.delete();
        } else {
          updateData[`stock.possessions.${hubId}`] = {
            ...(typeof hubData === "object" ? hubData : { name: "Legacy Hub" }),
            quantity: newHubStock,
            updatedAt: FieldValue.serverTimestamp(),
          };
        }

        transaction.update(itemRef, updateData);

        // Log the return
        const { logAuditEvent } =
          await import("../observability/logging/logger");
        await logAuditEvent(
          "INVENTORY_RETURNED_FROM_HUB",
          {
            businessId,
            itemId,
            itemName: itemData.name,
            hubId,
            hubName: typeof hubData === "number" ? "Legacy Hub" : hubData.name,
            quantity,
          },
          { currentStock: currentStationStock, hubStock: currentHubStock },
          { currentStock: newStationStock, hubStock: newHubStock },
        );
      });
    } catch (error) {
      logger.error(`Failed to return item ${itemId} from hub ${hubId}`, {
        error,
      });
      throw error;
    }
  }
}
