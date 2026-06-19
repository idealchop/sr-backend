import { db, FieldValue } from "../../config/firebase-admin";
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
  const customerRef = db
    .collection("businesses")
    .doc(args.businessId)
    .collection("customers")
    .doc(args.customerId);
  const customerSnap = await customerRef.get();
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

  const { successCount, invalidTokens } = await sendFcmMulticast(tokens, {
    title: args.statusLabel,
    body: `Order ${args.referenceId} — tap to track`,
    data: {
      type: "customer_txn_status",
      businessId: args.businessId,
      referenceId: args.referenceId,
      deepLink: args.trackUrl,
    },
  });

  if (invalidTokens.length > 0) {
    const valid = tokens.filter((t) => !invalidTokens.includes(t));
    await customerRef.set(
      {
        portalWebPushTokens: valid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    logger.info("customer_web_push_pruned_invalid_tokens", {
      businessId: args.businessId,
      customerId: args.customerId,
      count: invalidTokens.length,
    });
  }

  return { sent: successCount > 0 };
}

/** NT-34 — push when portal order is first received. */
export async function maybeSendPortalOrderReceivedWebPush(args: {
  businessId: string;
  customerId: string;
  referenceId: string;
  businessName: string;
  trackUrl: string;
}): Promise<{ sent: boolean }> {
  return maybeSendCustomerTxnWebPush({
    businessId: args.businessId,
    customerId: args.customerId,
    referenceId: args.referenceId,
    statusLabel: `${args.businessName.slice(0, 24)} received your order`,
    trackUrl: args.trackUrl,
  });
}
