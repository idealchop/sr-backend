import { db } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import type { Transaction } from "./transaction-types";

/**
 * Gets all transactions for a business with optional filters.
 */
export async function getTransactionsByBusiness(
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
  try {
    const orderField = options.orderBy ?? "scheduledAt";
    let query = db
      .collection("businesses")
      .doc(businessId)
      .collection("transactions")
      .orderBy(orderField, "desc");

    if (options.customerId) {
      query = query.where("customerId", "==", options.customerId);
    }
    if (options.startDate) {
      query = query.where("scheduledAt", ">=", new Date(options.startDate));
    }
    if (options.endDate) {
      query = query.where("scheduledAt", "<=", new Date(options.endDate));
    }

    query = query.limit(options.limit ?? 100);
    if (options.offset) query = query.offset(options.offset);

    const snapshot = await query.get();
    return snapshot.docs.map(
      (doc) => ({ id: doc.id, ...doc.data() }) as Transaction,
    );
  } catch (error) {
    logger.error(
      `Error fetching transactions for business ${businessId}`,
      error,
    );
    throw error;
  }
}

/**
 * Gets a single transaction.
 */
export async function getTransaction(
  businessId: string,
  transactionId: string,
): Promise<Transaction | null> {
  try {
    const doc = await db
      .collection("businesses")
      .doc(businessId)
      .collection("transactions")
      .doc(transactionId)
      .get();

    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() } as Transaction;
  } catch (error) {
    logger.error(`Error getting transaction ${transactionId}`, error);
    throw error;
  }
}

/**
 * Gets the audit history for a specific transaction.
 */
export async function getTransactionHistory(
  businessId: string,
  transactionId: string,
): Promise<Array<Record<string, unknown>>> {
  try {
    const snapshot = await db
      .collection("businesses")
      .doc(businessId)
      .collection("audit_logs")
      .where("transactionId", "==", transactionId)
      .orderBy("timestamp", "desc")
      .get();

    const rows: Array<Record<string, unknown>> = snapshot.docs.map((doc) => {
      const data = doc.data();
      // Fallback for older logs where 'event' wasn't a separate field
      let event = data.event;
      if (!event && data.message && data.message.startsWith("AUDIT: ")) {
        event = data.message.substring(7);
      } else if (
        !event &&
        data.message &&
        data.message.startsWith("SECURITY: ")
      ) {
        event = data.message.substring(10);
      }

      return {
        id: doc.id,
        ...data,
        event: event || "UNKNOWN_EVENT",
        // Convert Firestore timestamp to JS Date if it exists
        timestamp: data.timestamp?.toDate ?
          data.timestamp.toDate() :
          data.timestamp,
      };
    });

    const opaqueIdRe = /^[a-zA-Z0-9]{20,}$/;
    const unresolvedIds = new Set<string>();
    for (const row of rows) {
      const uid = typeof row.userId === "string" ? row.userId.trim() : "";
      const name =
        typeof row.userName === "string" ? row.userName.trim() : "";
      if (
        uid &&
        opaqueIdRe.test(uid) &&
        !uid.startsWith("rider_messenger:") &&
        (!name || opaqueIdRe.test(name) || name.toLowerCase() === "team member")
      ) {
        unresolvedIds.add(uid);
      }
    }

    if (unresolvedIds.size > 0) {
      const membersCol = db
        .collection("businesses")
        .doc(businessId)
        .collection("members");
      const nameByUid: Record<string, string> = {};
      await Promise.all(
        [...unresolvedIds].map(async (uid) => {
          const snap = await membersCol.doc(uid).get();
          if (!snap.exists) return;
          const d = snap.data() || {};
          const resolved = String(d.name || d.displayName || "").trim();
          if (resolved) nameByUid[uid] = resolved;
        }),
      );
      for (const row of rows) {
        const uid = typeof row.userId === "string" ? row.userId.trim() : "";
        if (uid && nameByUid[uid]) {
          row.userName = nameByUid[uid];
          if (!row.userType) row.userType = "staff";
        }
      }
    }

    return rows;
  } catch (error) {
    logger.error(
      `Error fetching history for transaction ${transactionId}`,
      error,
    );
    throw error;
  }
}
