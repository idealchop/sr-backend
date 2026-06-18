import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { db } from "../config/firebase-admin";

/**
 * SC-09 — owner data warehouse export job stub (BigQuery / GCS).
 * Nightly: enqueue export for Scale+ businesses with `dataWarehouseExportEnabled`.
 */
export const ownerDataWarehouseExport = onSchedule(
  {
    schedule: "every day 02:00",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "512MiB",
    timeoutSeconds: 300,
  },
  async () => {
    const snap = await db
      .collection("businesses")
      .where("dataWarehouseExportEnabled", "==", true)
      .limit(25)
      .get();

    let enqueued = 0;
    for (const doc of snap.docs) {
      await doc.ref.collection("export_jobs").add({
        type: "bigquery_rollup",
        status: "queued",
        schemaVersion: "2026-06",
        createdAt: new Date(),
        note: "Stub job — wire BigQuery extension or GCS sink.",
      });
      enqueued += 1;
    }

    logger.info("ownerDataWarehouseExport complete", {
      scanned: snap.size,
      enqueued,
    });
  },
);
