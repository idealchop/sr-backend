import { db } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { resolveNotificationPreferencesFromUiConfig } from "../../utils/notification-preferences";
import {
  deleteOwnerDevicesByTokens,
  listOwnerDevices,
} from "./owner-device-service";
import { sendFcmMulticast } from "./fcm-push-service";

export type DeliveryChatPushCopy = {
  title: string;
  body: string;
};

export function buildDeliveryChatPushCopy(params: {
  customerName: string;
  referenceId: string;
  preview: string;
}): DeliveryChatPushCopy {
  const name = params.customerName.trim() || "Customer";
  const ref = params.referenceId.trim();
  const preview = params.preview.trim().slice(0, 120);

  return {
    title: "Customer delivery chat",
    body: `${name}${ref ? ` (${ref})` : ""}: ${preview}`,
  };
}

/**
 * FCM to station owner devices when a customer sends a delivery chat message.
 */
export async function sendDeliveryMessengerChatPush(params: {
  businessId: string;
  threadId: string;
  customerName: string;
  referenceId: string;
  preview: string;
}): Promise<{ sent: boolean }> {
  const businessDoc = await db.collection("businesses").doc(params.businessId).get();
  if (!businessDoc.exists) return { sent: false };

  const uiConfig = (businessDoc.data()?.uiConfig ?? {}) as Record<string, unknown>;
  const prefs = resolveNotificationPreferencesFromUiConfig(uiConfig);
  if (prefs.newOrderPushEnabled !== true) {
    return { sent: false };
  }

  const devices = await listOwnerDevices(params.businessId);
  const tokens = devices.map((d) => d.fcmToken).filter(Boolean);
  if (!tokens.length) return { sent: false };

  const copy = buildDeliveryChatPushCopy({
    customerName: params.customerName,
    referenceId: params.referenceId,
    preview: params.preview,
  });

  const { successCount, invalidTokens } = await sendFcmMulticast(tokens, {
    title: copy.title,
    body: copy.body,
    data: {
      type: "delivery_messenger_chat",
      businessId: params.businessId,
      threadId: params.threadId,
      referenceId: params.referenceId,
      deepLink: "/dashboard?proactive=orders",
    },
  }, {
    deliveryLog: {
      businessId: params.businessId,
      category: "delivery_messenger_chat_push",
      audience: "owner",
    },
  });

  if (invalidTokens.length > 0) {
    await deleteOwnerDevicesByTokens(params.businessId, invalidTokens);
  }

  if (successCount <= 0) return { sent: false };

  logger.info("delivery_messenger_chat push sent", {
    businessId: params.businessId,
    threadId: params.threadId,
    successCount,
  });

  return { sent: true };
}

export async function sumDeliveryChatUnreadForBusiness(
  businessId: string,
): Promise<number> {
  const snap = await db
    .collection("delivery_messenger_chats")
    .where("businessId", "==", businessId)
    .where("status", "==", "open")
    .limit(100)
    .get();

  let total = 0;
  for (const doc of snap.docs) {
    const count = Number(doc.data()?.unreadCountForStation ?? 0);
    if (Number.isFinite(count) && count > 0) total += count;
  }
  return total;
}
