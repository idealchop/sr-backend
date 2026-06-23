import { getMessaging, type MulticastMessage } from "firebase-admin/messaging";
import { logger } from "firebase-functions";
import { manilaHour } from "../../utils/philippine-datetime";
import { AlertDeliveryLogService } from "./alert-delivery-log-service";

export type FcmPushPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

export type FcmSendOptions = {
  quietHoursStart?: number;
  quietHoursEnd?: number;
  /** NT-75 — write delivery outcome to alert_delivery_log when set. */
  deliveryLog?: {
    businessId: string;
    category: string;
    audience?: "owner" | "customer";
  };
};

/** NT-71 — block non-critical pushes outside configured Manila quiet hours. */
export function isPushBlockedByQuietHours(
  now: Date,
  quietHoursStart?: number,
  quietHoursEnd?: number,
): boolean {
  if (quietHoursStart == null || quietHoursEnd == null) return false;
  const hour = manilaHour(now);
  if (quietHoursStart === quietHoursEnd) return false;
  if (quietHoursStart < quietHoursEnd) {
    return hour < quietHoursStart || hour >= quietHoursEnd;
  }
  return hour >= quietHoursStart || hour < quietHoursEnd;
}

function isCriticalPushType(type: string | undefined): boolean {
  return type === "new_order";
}

/**
 * Sends the same notification to multiple FCM registration tokens.
 * @param {Array<string>} tokens Device tokens.
 * @param {FcmPushPayload} payload Notification content.
 * @param {FcmSendOptions} [options] Quiet-hours and delivery options.
 * @return {Promise<Object>} Send summary with successCount and invalidTokens.
 */
export async function sendFcmMulticast(
  tokens: string[],
  payload: FcmPushPayload,
  options?: FcmSendOptions,
): Promise<{ successCount: number; invalidTokens: string[]; skippedQuietHours?: boolean }> {
  const unique = [...new Set(tokens.map((t) => t.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return { successCount: 0, invalidTokens: [] };
  }

  const pushType = payload.data?.type;
  if (
    !isCriticalPushType(pushType) &&
    isPushBlockedByQuietHours(
      new Date(),
      options?.quietHoursStart,
      options?.quietHoursEnd,
    )
  ) {
    logger.info("FCM push skipped (quiet hours)", { type: pushType ?? "unknown" });
    if (options?.deliveryLog) {
      await AlertDeliveryLogService.record(options.deliveryLog.businessId, {
        channel: "push",
        category: options.deliveryLog.category,
        status: "skipped",
        audience: options.deliveryLog.audience ?? "owner",
        detail: { reason: "quiet_hours", pushType },
      });
    }
    return { successCount: 0, invalidTokens: [], skippedQuietHours: true };
  }

  const message: MulticastMessage = {
    tokens: unique,
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: payload.data ?? {},
    android: { priority: "high" },
    apns: {
      payload: {
        aps: {
          sound: "default",
        },
      },
    },
  };

  try {
    const response = await getMessaging().sendEachForMulticast(message);
    const invalidTokens: string[] = [];
    response.responses.forEach((item, index) => {
      if (item.success) return;
      const code = item.error?.code ?? "";
      if (
        code === "messaging/invalid-registration-token" ||
        code === "messaging/registration-token-not-registered"
      ) {
        invalidTokens.push(unique[index]);
      } else if (item.error) {
        logger.warn("FCM send failed for token", {
          code,
          message: item.error.message,
        });
      }
    });
    if (options?.deliveryLog) {
      const failureCount = unique.length - response.successCount;
      const status =
        response.successCount <= 0 ?
          "failed" :
          failureCount > 0 ?
            "partial" :
            "sent";
      await AlertDeliveryLogService.record(options.deliveryLog.businessId, {
        channel: "push",
        category: options.deliveryLog.category,
        status,
        audience: options.deliveryLog.audience ?? "owner",
        recipientCount: unique.length,
        successCount: response.successCount,
        failureCount,
        detail: {
          invalidTokenCount: invalidTokens.length,
          pushType: pushType ?? null,
        },
      });
    }
    return { successCount: response.successCount, invalidTokens };
  } catch (error) {
    logger.error("FCM multicast failed", error);
    throw error;
  }
}
