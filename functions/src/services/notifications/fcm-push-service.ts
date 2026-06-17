import { getMessaging, type MulticastMessage } from "firebase-admin/messaging";
import { logger } from "firebase-functions";

export type FcmPushPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

/**
 * Sends the same notification to multiple FCM registration tokens.
 * @param {Array<string>} tokens Device tokens.
 * @param {FcmPushPayload} payload Notification content.
 * @return {Promise<Object>} Send summary with successCount and invalidTokens.
 */
export async function sendFcmMulticast(
  tokens: string[],
  payload: FcmPushPayload,
): Promise<{ successCount: number; invalidTokens: string[] }> {
  const unique = [...new Set(tokens.map((t) => t.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return { successCount: 0, invalidTokens: [] };
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
    return { successCount: response.successCount, invalidTokens };
  } catch (error) {
    logger.error("FCM multicast failed", error);
    throw error;
  }
}
