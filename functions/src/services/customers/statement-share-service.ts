import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";

export type StatementShareRecord = {
  id: string;
  businessId: string;
  type: "transactionRecords";
  data: Record<string, unknown>;
};

/**
 * Public read-only snapshots for customer statement sharing (no auth on GET).
 */
export class StatementShareService {
  /**
   * Persists a statement snapshot; returns the public document id.
   * @param {string} businessId
   * @param {string} ownerId
   * @param {object} payload
   * @return {Promise<string>}
   */
  static async create(
    businessId: string,
    ownerId: string,
    payload: { type: "transactionRecords"; data: Record<string, unknown> },
  ): Promise<string> {
    try {
      const docRef = await db.collection("statementShares").add({
        businessId,
        ownerId,
        sharedAt: FieldValue.serverTimestamp(),
        type: payload.type,
        data: payload.data,
      });
      return docRef.id;
    } catch (error) {
      logger.error("Error creating statement share", error);
      throw error;
    }
  }

  static async getById(id: string): Promise<StatementShareRecord | null> {
    try {
      const doc = await db.collection("statementShares").doc(id).get();
      if (!doc.exists) return null;
      const d = doc.data() as {
        businessId: string;
        type: "transactionRecords";
        data: Record<string, unknown>;
      };
      return {
        id: doc.id,
        businessId: d.businessId,
        type: d.type,
        data: d.data || {},
      };
    } catch (error) {
      logger.error(`Error fetching statement share ${id}`, error);
      throw error;
    }
  }
}
