import { createLogger, format, transports } from "winston";
import { FirestoreTransport } from "./transports/firestore-transport";

// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
/**
 * JSON.stringify for console meta without throwing on circular refs
 * (e.g. Axios / Brevo HTTP errors: ClientRequest ↔ IncomingMessage).
 */
function safeStringifyLogMeta(meta: Record<string, unknown>): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(meta, (_key, value) => {
      if (typeof value === "function") {
        return "[Function]";
      }
      if (typeof value === "bigint") {
        return String(value);
      }
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
      }
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) {
          return "[Circular]";
        }
        seen.add(value);
      }
      return value;
    });
  } catch {
    return "\"[Unserializable meta]\"";
  }
}

/**
 * Centralized Logger for SmartRefill V3 API.
 * Follows the SmartRefill Analytics & Observability Protocol.
 */
export const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.errors({ stack: true }),
    format.json(),
  ),
  defaultMeta: {
    service: "smartrefill-v3-api",
    environment: process.env.NODE_ENV || "development",
  },
  transports: [
    // Standard Console Logging (for Firebase Functions Logs)
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(({ timestamp, level, message, ...meta }) => {
          const metaString = Object.keys(meta).length ?
            safeStringifyLogMeta(meta as Record<string, unknown>) :
            "";
          return `${timestamp} [${level}]: ${message} ${metaString}`;
        }),
      ),
    }),
    // Firestore Audit Trail
    new FirestoreTransport({
      collection: "audit_logs",
    }),
  ],
});

/**
 * Helper to log business-critical audit events.
 * @param {string} event The event name.
 * @param {Record<string, any>} context The event context (must include businessId).
 * @param {any} oldValue Optional old value for change tracking.
 * @param {any} newValue Optional new value for change tracking.
 * @param {string} transactionId Optional transaction ID for specific history tracking.
 * @param {string[]} changedFields Optional list of fields that were modified.
 */
export const logAuditEvent = async (
  event: string,
  context: Record<string, any>,
  oldValue?: any,
  newValue?: any,
  transactionId?: string,
  changedFields?: string[],
) => {
  logger.info(`AUDIT: ${event}`, {
    event,
    ...context,
    oldValue,
    newValue,
    transactionId,
    changedFields,
    auditType: "business_event",
  });
};

/**
 * Helper to log security/auth events.
 * @param {string} event The event name.
 * @param {Record<string, any>} context The event context.
 */
export const logSecurityEvent = async (
  event: string,
  context: Record<string, any>,
) => {
  logger.warn(`SECURITY: ${event}`, {
    event,
    ...context,
    auditType: "security_event",
  });
};

/**
 * Writes a concise audit line (max 100 chars) for triage / portal actions.
 * @param {string} event The event name
 * @param {string} businessId The business ID
 * @param {string} summary The summary text
 * @param {Record<string, unknown>} extra Extra context
 */
export const logAuditSummary = async (
  event: string,
  businessId: string,
  summary: string,
  extra: Record<string, unknown> = {},
) => {
  const trimmed = summary.length > 100 ? `${summary.slice(0, 97)}...` : summary;
  logger.info(`AUDIT: ${event}`, {
    event,
    businessId,
    summary: trimmed,
    auditType: "business_event",
    ...extra,
  });
};
