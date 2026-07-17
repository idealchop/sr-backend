import { FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { RiderService } from "../riders/rider-service";
import type { Transaction } from "./transaction-types";

/**
 * When a business has exactly one non-inactive rider, use them as the default assignee
 * for delivery/collection dispatches (no manual rider picker needed).
 */
export async function getSoleActiveRiderId(
  businessId: string,
): Promise<string | undefined> {
  try {
    const riders = await RiderService.getRidersByBusiness(businessId);
    const active = riders.filter((r) => r.status !== "inactive" && r.id);
    if (active.length === 1 && active[0].id) {
      return active[0].id;
    }
  } catch (e) {
    logger.warn("getSoleActiveRiderId failed", e);
  }
  return undefined;
}

export async function syncTransactionRiderRef(
  businessId: string,
  updates: Partial<Transaction> & { riderId?: unknown; riderName?: unknown },
): Promise<void> {
  if (!Object.prototype.hasOwnProperty.call(updates, "riderId")) return;

  const raw = updates.riderId;
  if (raw === null || raw === undefined || raw === "") {
    updates.riderId = FieldValue.delete() as unknown as undefined;
    updates.riderName = FieldValue.delete() as unknown as undefined;
    return;
  }

  const linked = await RiderService.resolveRiderDocumentId(
    businessId,
    String(raw),
  );
  if (!linked) {
    throw new Error(
      "Rider assignment must reference a profile in the riders collection.",
    );
  }

  updates.riderId = linked.riderId;
  updates.riderName = linked.riderName;
}
