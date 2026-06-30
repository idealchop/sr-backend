import { db } from "../../config/firebase-admin";
import { sendCommunityDispatchOfferPush } from "../notifications/community-dispatch-offer-push-service";
import type { CommunityDispatchRequestDoc } from "../meta/community-dispatch-request-types";

export async function isSalesPortalOpsUser(uid: string): Promise<boolean> {
  const snap = await db.collection("sales").doc(uid).get();
  if (!snap.exists) return false;
  const role = snap.data()?.role;
  return role === "admin" || role === "manager";
}

export async function notifyCommunityDispatchOfferFromOps(params: {
  offerId: string;
  requestId: string;
  businessId: string;
}): Promise<{ sent: boolean }> {
  const requestSnap = await db
    .collection("community_dispatch_requests")
    .doc(params.requestId)
    .get();
  if (!requestSnap.exists) {
    throw new Error("NOT_FOUND");
  }

  const request = requestSnap.data() as CommunityDispatchRequestDoc;
  return sendCommunityDispatchOfferPush({
    businessId: params.businessId,
    requestId: params.requestId,
    request,
    offerId: params.offerId,
    rank: 0,
  });
}
