import { db } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { resolveNotificationPreferencesFromUiConfig } from "../../utils/notification-preferences";
import {
  deleteOwnerDevicesByTokens,
  listOwnerDevices,
} from "./owner-device-service";
import { sendFcmMulticast } from "./fcm-push-service";
import type { CommunityDispatchRequestDoc } from "../meta/community-dispatch-request-types";
import { COMMUNITY_OFFER_RESPONSE_MINUTES } from "../meta/community-dispatch-geo-utils";
import { isBusinessEligibleForCommunityMessenger } from "../../utils/community-messenger-plan-access";

const OFFER_TTL_MINUTES = COMMUNITY_OFFER_RESPONSE_MINUTES;

export type CommunityOfferPushCopy = {
  title: string;
  body: string;
};

export function buildCommunityOfferPushCopy(params: {
  customerName: string;
  qty?: number;
  delivery?: boolean;
  referenceId: string;
  rank: number;
}): CommunityOfferPushCopy {
  const name = params.customerName.trim() || "Customer";
  const qtyPart = params.qty != null ? `${params.qty} gal` : "order";
  const kind = params.delivery === false ? "pickup" : "delivery";
  const ref = params.referenceId.trim();

  return {
    title: "Community order — respond now",
    body: `${name} · ${qtyPart} ${kind}${ref ? ` (${ref})` : ""} — first to accept wins (${OFFER_TTL_MINUTES} min).`,
  };
}

/**
 * CP-15 / NT-54 — FCM to station owners when a community dispatch offer is pending.
 */
export async function sendCommunityDispatchOfferPush(params: {
  businessId: string;
  requestId: string;
  request: CommunityDispatchRequestDoc;
  offerId: string;
  rank: number;
}): Promise<{ sent: boolean }> {
  if (!(await isBusinessEligibleForCommunityMessenger(params.businessId))) {
    return { sent: false };
  }

  const businessDoc = await db.collection("businesses").doc(params.businessId).get();
  if (!businessDoc.exists) return { sent: false };

  const community = businessDoc.data()?.communityDispatch as { enabled?: boolean } | undefined;
  if (community?.enabled !== true) return { sent: false };

  const uiConfig = (businessDoc.data()?.uiConfig ?? {}) as Record<string, unknown>;
  const prefs = resolveNotificationPreferencesFromUiConfig(uiConfig);
  if (prefs.newOrderPushEnabled !== true) {
    return { sent: false };
  }

  const devices = await listOwnerDevices(params.businessId);
  const tokens = devices.map((d) => d.fcmToken).filter(Boolean);
  if (!tokens.length) return { sent: false };

  const fields = params.request.parsed ?? {};
  const copy = buildCommunityOfferPushCopy({
    customerName: fields.name ?? "Customer",
    qty: fields.qty,
    delivery: fields.delivery,
    referenceId: params.request.referenceId,
    rank: params.rank,
  });

  const { successCount, invalidTokens } = await sendFcmMulticast(tokens, {
    title: copy.title,
    body: copy.body,
    data: {
      type: "community_dispatch_offer",
      businessId: params.businessId,
      offerId: params.offerId,
      requestId: params.requestId,
      referenceId: params.request.referenceId,
      deepLink: "/dashboard?proactive=orders",
    },
  }, {
    deliveryLog: {
      businessId: params.businessId,
      category: "community_dispatch_offer_push",
      audience: "owner",
    },
  });

  if (invalidTokens.length > 0) {
    await deleteOwnerDevicesByTokens(params.businessId, invalidTokens);
  }

  if (successCount <= 0) return { sent: false };

  logger.info("community_dispatch_offer push sent", {
    businessId: params.businessId,
    offerId: params.offerId,
    rank: params.rank,
    successCount,
  });

  return { sent: true };
}
