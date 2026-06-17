import Transport from "winston-transport";
import { db, FieldValue } from "../../../../config/firebase-admin";

interface FirestoreTransportOptions extends Transport.TransportStreamOptions {
  collection?: string;
}

/**
 * Winston transport: persists business-scoped audit lines to Firestore.
 * Logs without `businessId` are **not** written to Firestore (no `system_logs` sink) —
 * they remain on console only.
 */
export class FirestoreTransport extends Transport {
  private collection: string;

  constructor(opts: FirestoreTransportOptions) {
    super(opts);
    this.collection = opts.collection || "audit_logs";
  }

  private deepClean(obj: any): any {
    if (obj === null) {
      return null;
    }

    if (typeof obj === "function") {
      return "[Function]";
    }

    if (typeof obj !== "object") {
      return obj;
    }

    // Handle Arrays
    if (Array.isArray(obj)) {
      return obj.map((v) => this.deepClean(v));
    }

    // Identify the constructor name
    const constructorName = obj.constructor ? obj.constructor.name : null;

    // Allow Firestore/Firebase special types to pass through
    const safeFirestoreTypes = [
      "FieldValue",
      "Timestamp",
      "Date",
      "GeoPoint",
      "DocumentReference",
      "ServerTimestampTransform",
    ];

    if (constructorName && safeFirestoreTypes.includes(constructorName)) {
      return obj;
    }

    // For any other object (plain or class instance), we create a plain object
    // and recursively clean its properties.
    const cleanObj: any = {};
    let hasEnumerableProps = false;

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const val = obj[key];
        if (val !== undefined) {
          cleanObj[key] = this.deepClean(val);
          hasEnumerableProps = true;
        }
      }
    }

    // If it's a class instance but has no enumerable properties,
    // return a string representation to ensure something useful is logged.
    if (
      !hasEnumerableProps &&
      constructorName &&
      constructorName !== "Object"
    ) {
      return constructorName;
    }

    return cleanObj;
  }

  async log(info: any, callback: () => void) {
    setImmediate(() => {
      this.emit("logged", info);
    });

    try {
      const { level, message, ...meta } = info;

      // We only store INFO and above in the audit trail to save costs
      if (level === "error" || level === "warn" || level === "info") {
        const businessId = meta.businessId as string | undefined;
        // Platform-wide logs stay on Winston console only (no system_logs collection).
        if (!businessId) {
          callback();
          return;
        }

        const payload = this.deepClean({
          level,
          message,
          ...meta,
          environment: process.env.NODE_ENV || "development",
        });

        // Add server timestamp after cleaning to avoid serializing the sentinel
        payload.timestamp = FieldValue.serverTimestamp();

        await db
          .collection("businesses")
          .doc(businessId)
          .collection("audit_logs")
          .add(payload);
      }
    } catch (error) {
      console.error("Failed to write log to Firestore:", error);
    }

    callback();
  }
}
