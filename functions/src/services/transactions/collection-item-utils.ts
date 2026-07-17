import type {
  CollectionItem,
  CollectionItemStatus,
} from "./transaction-types";
import { buildAuditActorFields } from "../../utils/audit-actor";
import { logAuditEvent } from "../observability/logging/logger";

/**
 * Human-readable summary of a collection line (qty OK, damaged, missing, etc.).
 * @param {CollectionItem} item Collection line from a transaction.
 * @return {string} Description for logs and audit.
 */
export function describeCollectionLine(item: CollectionItem): string {
  const parts: string[] = [
    `${item.name}: expected ${item.qtyExpected}, OK ${item.qtyOk}`,
  ];
  if ((item.qtyDamaged || 0) > 0) parts.push(`damaged ${item.qtyDamaged}`);
  if ((item.qtyMissing || 0) > 0) parts.push(`missing ${item.qtyMissing}`);
  if ((item.deficitQty || 0) > 0) parts.push(`owed ${item.deficitQty}`);
  if (
    item.replacedFromInventory &&
    ((item.qtyDamaged || 0) + (item.qtyMissing || 0)) > 0
  ) {
    parts.push(
      `replaced ${(item.qtyDamaged || 0) + (item.qtyMissing || 0)} from stock`,
    );
  }
  if (item.recoveredFromTxIds?.length) {
    parts.push("recovered prior container deficit");
  }
  if (item.recoveryLinks?.length) {
    const applied = item.recoveryLinks.reduce((s, l) => s + l.amount, 0);
    parts.push(`${applied} applied to older owed qty`);
  }
  return parts.join("; ");
}

/**
 * Normalizes collection items by calculating deficitQty and status hierarchy.
 * @param {CollectionItem[]} items The items to normalize.
 * @return {CollectionItem[]} The normalized items.
 */
export function normalizeCollectionItems(
  items: CollectionItem[],
): CollectionItem[] {
  return items.map((item) => {
    const qtyOk = item.qtyOk || 0;
    const qtyExpected = item.qtyExpected || 0;
    const deficitQty = Math.max(0, qtyExpected - qtyOk);
    let qtyDamaged = item.qtyDamaged || 0;
    let qtyMissing = item.qtyMissing || 0;

    // Auto-fill qtyDamaged/qtyMissing if status was explicitly set but qtys were not
    if (item.status === "damaged" && qtyDamaged === 0 && deficitQty > 0) {
      qtyDamaged = deficitQty;
    }
    if (item.status === "missing" && qtyMissing === 0 && deficitQty > 0) {
      qtyMissing = deficitQty;
    }

    let status: CollectionItemStatus = "ok";
    if (qtyOk > qtyExpected) {
      status = "recovered";
    } else if (qtyDamaged > 0) {
      status = "damaged";
    } else if (qtyMissing > 0 || deficitQty > 0) {
      status = "missing";
    } else if (qtyOk === qtyExpected) {
      status = "ok";
    }

    const normalizedItem: CollectionItem = {
      ...item,
      qtyOk,
      qtyDamaged,
      qtyMissing,
      qtyCollected: qtyOk, // Forced sync: qtyCollected always equals qtyOk
      deficitQty,
      status,
      replacedFromInventory:
        item.replacedFromInventory ?? (qtyDamaged > 0 || qtyMissing > 0),
    };

    return normalizedItem;
  });
}

/**
 * Audit trail for collection container lines on a transaction.
 */
export async function logCollectionContainerAudit(
  businessId: string,
  transactionId: string,
  customerId: string,
  collectionItems: CollectionItem[],
  userId: string | undefined,
  event: string,
  referenceId?: string,
  userName?: string,
): Promise<void> {
  if (!collectionItems.length) return;
  const actor = buildAuditActorFields(userId, userName);
  const containerLines = collectionItems.map((i) => describeCollectionLine(i));
  await logAuditEvent(
    event,
    {
      businessId,
      customerId,
      ...actor,
      referenceId,
      summary: containerLines.join(" | "),
      containerLines,
    },
    null,
    { collectionItems },
    transactionId,
  );
}
