import { db } from "../../config/firebase-admin";
import { logger } from "firebase-functions";
import { sendFcmMulticast } from "../notifications/fcm-push-service";

/**
 * NT-34 — customer Web Push on portal track (PWA subscription stored on customer doc).
 */
export async function maybeSendCustomerTxnWebPush(args: {
  businessId: string;
  customerId: string;
  referenceId: string;
  statusLabel: string;
  trackUrl: string;
}): Promise<{ sent: boolean }> {
  const customerSnap = await db
    .collection("businesses")
    .doc(args.businessId)
    .collection("customers")
    .doc(args.customerId)
    .get();
  if (!customerSnap.exists) return { sent: false };

  const data = customerSnap.data() ?? {};
  const tokens = Array.isArray(data.portalWebPushTokens) ?
    data.portalWebPushTokens.filter(
      (t): t is string => typeof t === "string" && t.length > 0,
    ) :
    [];
  if (tokens.length === 0) return { sent: false };

  if (process.env.FUNCTIONS_EMULATOR) {
    logger.info("EMULATOR: customer web push", {
      businessId: args.businessId,
      referenceId: args.referenceId,
      tokenCount: tokens.length,
    });
    return { sent: true };
  }

  const { successCount } = await sendFcmMulticast(tokens, {
    title: args.statusLabel,
    body: `Order ${args.referenceId} — tap to track`,
    data: {
      type: "customer_txn_status",
      businessId: args.businessId,
      referenceId: args.referenceId,
      deepLink: args.trackUrl,
    },
  });

  return { sent: successCount > 0 };
}
