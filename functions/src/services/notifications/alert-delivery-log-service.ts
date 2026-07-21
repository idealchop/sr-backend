import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "firebase-functions";

export type AlertDeliveryChannel = "push" | "email" | "sms";

export type AlertDeliveryStatus = "sent" | "partial" | "failed" | "skipped";

export type AlertDeliveryLogInput = {
  channel: AlertDeliveryChannel;
  category: string;
  status: AlertDeliveryStatus;
  audience?: "owner" | "customer";
  recipientCount?: number;
  successCount?: number;
  failureCount?: number;
  detail?: Record<string, unknown>;
};

export type AlertDeliveryLogRecord = AlertDeliveryLogInput & {
  id: string;
  createdAt: string;
  contributorId?: string;
  sent?: boolean;
};

export type ListAlertDeliveryLogOptions = {
  limit?: number;
  /** When set, only rows for this suki (email channel by default). */
  customerId?: string;
  customerEmail?: string | null;
  /** Transaction reference ids belonging to the customer (legacy matching). */
  referenceIds?: string[];
  channel?: AlertDeliveryChannel;
  audience?: "owner" | "customer";
};

function collection(businessId: string) {
  return db.collection("businesses").doc(businessId).collection("alert_delivery_log");
}

function serialize(
  id: string,
  data: FirebaseFirestore.DocumentData,
): AlertDeliveryLogRecord {
  const createdAt = data.createdAt?.toDate ?
    data.createdAt.toDate().toISOString() :
    String(data.createdAt || new Date().toISOString());

  if (data.channel) {
    return {
      id,
      channel: data.channel as AlertDeliveryChannel,
      category: String(data.category || data.contributorId || "unknown"),
      status: (data.status as AlertDeliveryStatus) || "sent",
      audience: data.audience as "owner" | "customer" | undefined,
      recipientCount:
        data.recipientCount != null ? Number(data.recipientCount) : undefined,
      successCount:
        data.successCount != null ? Number(data.successCount) : undefined,
      failureCount:
        data.failureCount != null ? Number(data.failureCount) : undefined,
      detail: (data.detail as Record<string, unknown>) ?? {},
      createdAt,
      contributorId: data.contributorId ?
        String(data.contributorId) :
        undefined,
    };
  }

  return {
    id,
    channel: inferLegacyChannel(String(data.contributorId || "")),
    category: String(data.contributorId || "proactive_alert"),
    status: data.sent === false ? "failed" : "sent",
    detail: (data.detail as Record<string, unknown>) ?? {},
    createdAt,
    contributorId: String(data.contributorId || ""),
    sent: data.sent === true,
  };
}

function inferLegacyChannel(contributorId: string): AlertDeliveryChannel {
  if (contributorId.includes("email")) return "email";
  if (contributorId.includes("sms")) return "sms";
  return "push";
}

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

/**
 * Match delivery-log rows to a customer (new rows use detail.customerId / toEmail;
 * legacy rows match by order referenceId).
 */
export function matchesCustomerDeliveryLog(
  entry: Pick<AlertDeliveryLogRecord, "audience" | "detail">,
  args: {
    customerId: string;
    customerEmail?: string | null;
    referenceIds?: Iterable<string>;
  },
): boolean {
  const detail = entry.detail ?? {};
  const customerId = String(args.customerId || "").trim();
  if (!customerId) return false;

  if (entry.audience && entry.audience !== "customer") return false;

  if (String(detail.customerId || "").trim() === customerId) return true;

  const email = normalizeEmail(args.customerEmail);
  if (email && normalizeEmail(detail.toEmail) === email) return true;

  const ref = String(detail.referenceId || "").trim();
  if (ref && args.referenceIds) {
    for (const id of args.referenceIds) {
      if (String(id || "").trim() === ref) return true;
    }
  }
  return false;
}

/** NT-75 — owner-visible delivery log for push, email, and SMS. */
export class AlertDeliveryLogService {
  static async record(
    businessId: string,
    input: AlertDeliveryLogInput,
  ): Promise<void> {
    if (!businessId) return;
    try {
      await collection(businessId).add({
        channel: input.channel,
        category: input.category,
        status: input.status,
        audience: input.audience ?? null,
        recipientCount: input.recipientCount ?? null,
        successCount: input.successCount ?? null,
        failureCount: input.failureCount ?? null,
        detail: input.detail ?? {},
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      logger.warn("alert_delivery_log write failed", { businessId, error });
    }
  }

  static async list(
    businessId: string,
    limit = 50,
  ): Promise<AlertDeliveryLogRecord[]> {
    const snap = await collection(businessId)
      .orderBy("createdAt", "desc")
      .limit(Math.min(Math.max(limit, 1), 100))
      .get();
    return snap.docs.map((doc) => serialize(doc.id, doc.data()));
  }

  /**
   * Customer-scoped email history for CRM profile.
   * Scans recent logs (up to 100) and filters by customerId / toEmail / order refs.
   */
  static async listForCustomer(
    businessId: string,
    customerId: string,
    options: ListAlertDeliveryLogOptions = {},
  ): Promise<AlertDeliveryLogRecord[]> {
    const channel = options.channel ?? "email";
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const scanLimit = 100;
    const rows = await this.list(businessId, scanLimit);

    return rows
      .filter((row) => {
        if (channel && row.channel !== channel) return false;
        if (options.audience && row.audience && row.audience !== options.audience) {
          return false;
        }
        return matchesCustomerDeliveryLog(row, {
          customerId,
          customerEmail: options.customerEmail,
          referenceIds: options.referenceIds,
        });
      })
      .slice(0, limit);
  }

  static async getById(
    businessId: string,
    logId: string,
  ): Promise<AlertDeliveryLogRecord | null> {
    const doc = await collection(businessId).doc(logId).get();
    if (!doc.exists) return null;
    return serialize(doc.id, doc.data() ?? {});
  }
}

export function mapContributorToDeliveryLog(
  contributorId: string,
  sent: boolean,
  detail?: Record<string, unknown>,
): AlertDeliveryLogInput {
  const channel = inferLegacyChannel(contributorId);
  return {
    channel,
    category: contributorId,
    status: sent ? "sent" : "skipped",
    audience: "owner",
    detail,
  };
}

/** Shared detail fields for customer transactional emails. */
export function customerDeliveryDetail(
  base: Record<string, unknown>,
  args: { customerId: string; toEmail?: string | null },
): Record<string, unknown> {
  const toEmail = normalizeEmail(args.toEmail);
  return {
    ...base,
    customerId: args.customerId,
    ...(toEmail ? { toEmail } : {}),
  };
}
