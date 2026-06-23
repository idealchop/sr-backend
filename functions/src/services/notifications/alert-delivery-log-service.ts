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
