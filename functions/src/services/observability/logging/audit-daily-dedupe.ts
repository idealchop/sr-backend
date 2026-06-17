import { db, FieldValue } from "../../../config/firebase-admin";
import { utcCalendarDayKey } from "../../auth/session-activity-service";

function auditLogDocIdForUtcDay(event: string, dayKey: string): string {
  const safeEvent = event.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${safeEvent}_${dayKey}`;
}

/**
 * Writes a business audit line at most once per UTC calendar day per event name.
 * Uses deterministic `audit_logs/{event}_{YYYY-MM-DD}` so repeat calls the same day are no-ops.
 * @param {string} event Audit event name.
 * @param {Record<string, unknown>} context Must include `businessId`.
 * @return {Promise<boolean>} True when a new audit_logs document was created.
 */
export async function logAuditEventOncePerUtcDay(
  event: string,
  context: Record<string, unknown> & { businessId: string },
): Promise<boolean> {
  const { businessId } = context;
  if (!businessId) return false;

  const dayKey = utcCalendarDayKey();
  const logRef = db
    .collection("businesses")
    .doc(businessId)
    .collection("audit_logs")
    .doc(auditLogDocIdForUtcDay(event, dayKey));

  const created = await db.runTransaction(async (tx) => {
    const existing = await tx.get(logRef);
    if (existing.exists) return false;

    tx.set(logRef, {
      level: "info",
      message: `AUDIT: ${event}`,
      event,
      ...context,
      auditType: "business_event",
      calendarDayUtc: dayKey,
      environment: process.env.NODE_ENV || "development",
      service: "smartrefill-v3-api",
      timestamp: FieldValue.serverTimestamp(),
    });
    return true;
  });

  return created;
}
