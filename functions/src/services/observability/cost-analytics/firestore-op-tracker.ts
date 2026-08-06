import { logger } from "../logging/logger";
import { resolveFirestoreDatabaseId } from "../../../config/dev-tier";

export type FirestoreOpApp = "smartrefill" | "sales-portal";

export type FirestoreOpEvent = {
  app: FirestoreOpApp;
  /** Stable operation id, e.g. community.dispatch.expire */
  operation: string;
  reads?: number;
  writes?: number;
  deletes?: number;
  businessId?: string;
  extra?: Record<string, unknown>;
};

/**
 * Structured Firestore cost breadcrumb for Cloud Logging.
 * Does not write to Firestore (avoids recursive spend).
 */
export function trackFirestoreOperation(event: FirestoreOpEvent): void {
  const reads = Math.max(0, Math.floor(event.reads ?? 0));
  const writes = Math.max(0, Math.floor(event.writes ?? 0));
  const deletes = Math.max(0, Math.floor(event.deletes ?? 0));
  if (reads + writes + deletes === 0 && !event.extra) return;

  logger.info("firestore_op", {
    event: "firestore_op",
    app: event.app,
    operation: event.operation,
    firestoreDatabaseId: resolveFirestoreDatabaseId(),
    gcpProject: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT ||
      "aquaflow-management-suite",
    reads,
    writes,
    deletes,
    businessId: event.businessId,
    ...(event.extra || {}),
  });
}
