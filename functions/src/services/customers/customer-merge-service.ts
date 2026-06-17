import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { CustomerService } from "./customer-service";

const BATCH_SIZE = 400;

/**
 * Merges duplicate customer profiles into a primary record for V3 multi-tenant schema.
 * - Re-points `transactions` with `customerId` in duplicate set to the primary.
 * - Deletes duplicate `customers` documents.
 * - Optionally merges missing phone/address onto primary when primary fields are empty.
 */
export class CustomerMergeService {
  static async mergeCustomers(params: {
    businessId: string;
    primaryCustomerId: string;
    duplicateCustomerIds: string[];
    actorUid: string;
  }): Promise<{ updatedTransactions: number; deletedCustomers: number }> {
    const { businessId, primaryCustomerId, duplicateCustomerIds, actorUid } =
      params;
    const dupes = duplicateCustomerIds.filter(
      (id) => id && id !== primaryCustomerId,
    );
    if (!dupes.length) {
      throw new Error("NO_DUPLICATES");
    }

    const primary = await CustomerService.getCustomer(
      businessId,
      primaryCustomerId,
    );
    if (!primary?.id) {
      throw new Error("PRIMARY_NOT_FOUND");
    }

    for (const id of dupes) {
      const c = await CustomerService.getCustomer(businessId, id);
      if (!c) throw new Error(`DUPLICATE_NOT_FOUND:${id}`);
    }

    let updatedTransactions = 0;

    for (const dupId of dupes) {
      const snap = await db
        .collection("businesses")
        .doc(businessId)
        .collection("transactions")
        .where("customerId", "==", dupId)
        .get();

      const chunks = snap.docs;
      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const slice = chunks.slice(i, i + BATCH_SIZE);
        for (const docSnap of slice) {
          batch.update(docSnap.ref, {
            customerId: primaryCustomerId,
            customerName: primary.name,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        await batch.commit();
        updatedTransactions += slice.length;
      }
    }

    const patch: Record<string, unknown> = {};
    if (!primary.phone && dupes.length) {
      for (const id of dupes) {
        const c = await CustomerService.getCustomer(businessId, id);
        if (c?.phone) {
          patch.phone = c.phone;
          break;
        }
      }
    }
    if (!primary.address && dupes.length) {
      for (const id of dupes) {
        const c = await CustomerService.getCustomer(businessId, id);
        if (c?.address) {
          patch.address = c.address;
          break;
        }
      }
    }
    if (Object.keys(patch).length) {
      patch.updatedAt = FieldValue.serverTimestamp();
      await db
        .collection("businesses")
        .doc(businessId)
        .collection("customers")
        .doc(primaryCustomerId)
        .update(patch);
    }

    let deletedCustomers = 0;
    for (const id of dupes) {
      await CustomerService.deleteCustomer(businessId, id);
      deletedCustomers++;
    }

    logger.info("customer_merge_complete", {
      businessId,
      primaryCustomerId,
      duplicateCustomerIds: dupes,
      updatedTransactions,
      deletedCustomers,
      actorUid,
    });

    return { updatedTransactions, deletedCustomers };
  }
}
