import {
  describeCollectionLine as describeCollectionLineUtil,
  logCollectionContainerAudit as logCollectionContainerAuditUtil,
  normalizeCollectionItems as normalizeCollectionItemsUtil,
} from "./collection-item-utils";
import {
  syncCustomerAssetPossession as syncCustomerAssetPossessionFn,
} from "./sync-customer-asset-possession";
import { reverseTransactionEffects as reverseTransactionEffectsFn } from "./reverse-transaction-effects";
import { addTransaction as addTransactionFn } from "./add-transaction";
import { updateTransaction as updateTransactionFn } from "./update-transaction";
import { deleteTransaction as deleteTransactionFn } from "./delete-transaction";
import {
  getTransaction as getTransactionFn,
  getTransactionHistory as getTransactionHistoryFn,
  getTransactionsByBusiness as getTransactionsByBusinessFn,
} from "./transaction-queries";
import type {
  AddTransactionResult,
  CollectionItem,
  Transaction,
  TransactionInventoryItem,
} from "./transaction-types";

export type {
  AddTransactionResult,
  CollectionItem,
  CollectionItemStatus,
  Transaction,
  TransactionInventoryItem,
  TransactionPayment,
  TransactionRefill,
} from "./transaction-types";

export { InsufficientStockError } from "../inventory/inventory-service";

/**
 * Facade for transaction domain operations. Implementations live in sibling modules.
 */
export class TransactionService {
  static async addTransaction(
    businessId: string,
    transaction: Partial<Transaction>,
    userId?: string,
    userName?: string,
  ): Promise<AddTransactionResult> {
    return addTransactionFn(businessId, transaction, userId, userName);
  }

  /**
   * Updates a transaction.
   * @param {string} businessId The business ID.
   * @param {string} transactionId The transaction ID.
   * @param {Partial<Transaction>} updates The updates.
   * @param {string} [userId] The user ID of the person performing the action.
   */
  static async updateTransaction(
    businessId: string,
    transactionId: string,
    updates: Partial<Transaction>,
    userId?: string,
    userName?: string,
  ): Promise<boolean> {
    return updateTransactionFn(
      businessId,
      transactionId,
      updates,
      userId,
      userName,
    );
  }

  /**
   * Reverses the effects of a transaction (inventory and possession).
   * @param {string} businessId The business ID.
   * @param {string} transactionId The transaction ID.
   * @param {Transaction} transaction The transaction data.
   * @param {string} [userId] The user ID of the person performing the action.
   */
  static async reverseTransactionEffects(
    businessId: string,
    transactionId: string,
    transaction: Transaction,
    userId?: string,
    userName?: string,
  ): Promise<void> {
    return reverseTransactionEffectsFn(
      businessId,
      transactionId,
      transaction,
      userId,
      userName,
    );
  }

  /**
   * Human-readable summary of a collection line (qty OK, damaged, missing, etc.).
   * @param {CollectionItem} item Collection line from a transaction.
   * @return {string} Description for logs and audit.
   */
  static describeCollectionLine(item: CollectionItem): string {
    return describeCollectionLineUtil(item);
  }

  static async logCollectionContainerAudit(
    businessId: string,
    transactionId: string,
    customerId: string,
    collectionItems: CollectionItem[],
    userId: string | undefined,
    event: string,
    referenceId?: string,
    userName?: string,
  ): Promise<void> {
    return logCollectionContainerAuditUtil(
      businessId,
      transactionId,
      customerId,
      collectionItems,
      userId,
      event,
      referenceId,
      userName,
    );
  }

  static async syncCustomerAssetPossession(
    businessId: string,
    customerId: string,
    deliveryItems: TransactionInventoryItem[] = [],
    collectionItems: CollectionItem[] = [],
    transactionId: string,
    userId?: string,
    isReverse = false,
    userName?: string,
  ): Promise<void> {
    return syncCustomerAssetPossessionFn(
      businessId,
      customerId,
      deliveryItems,
      collectionItems,
      transactionId,
      userId,
      isReverse,
      userName,
    );
  }

  /**
   * Normalizes collection items by calculating deficitQty and status hierarchy.
   * @param {CollectionItem[]} items The items to normalize.
   * @return {CollectionItem[]} The normalized items.
   */
  static normalizeCollectionItems(items: CollectionItem[]): CollectionItem[] {
    return normalizeCollectionItemsUtil(items);
  }

  /**
   * Gets all transactions for a business with optional filters.
   * @param {string} businessId The business ID.
   * @param {Object} options Optional query options.
   */
  static async getTransactionsByBusiness(
    businessId: string,
    options: {
      limit?: number;
      offset?: number;
      customerId?: string;
      startDate?: string;
      endDate?: string;
      orderBy?: "scheduledAt" | "createdAt";
    } = {},
  ): Promise<Transaction[]> {
    return getTransactionsByBusinessFn(businessId, options);
  }

  /**
   * Gets a single transaction.
   * @param {string} businessId The business ID.
   * @param {string} transactionId The transaction ID.
   */
  static async getTransaction(
    businessId: string,
    transactionId: string,
  ): Promise<Transaction | null> {
    return getTransactionFn(businessId, transactionId);
  }

  /**
   * Gets the audit history for a specific transaction.
   * @param {string} businessId The business ID.
   * @param {string} transactionId The transaction ID.
   */
  static async getTransactionHistory(
    businessId: string,
    transactionId: string,
  ): Promise<Array<Record<string, unknown>>> {
    return getTransactionHistoryFn(businessId, transactionId);
  }

  /**
   * Deletes a transaction record.
   * @param {string} businessId The business ID.
   * @param {string} transactionId The transaction ID.
   * @param {string} [userId] The user ID of the person performing the action.
   */
  static async deleteTransaction(
    businessId: string,
    transactionId: string,
    userId?: string,
    userName?: string,
  ): Promise<void> {
    return deleteTransactionFn(businessId, transactionId, userId, userName);
  }
}
