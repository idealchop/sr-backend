import { resolveAppBaseUrlForEmail } from "../../utils/app-base-url";
import { logger } from "../observability/logging/logger";
import {
  COMMUNITY_OFFER_RESPONSE_MINUTES,
  estimateCommunityDeliveryEtaMinutes,
  estimateCommunityPickupReadyMinutes,
  formatDistanceKmForMessenger,
  formatEtaMinutesForMessenger,
  haversineDistanceKm,
} from "./community-dispatch-geo-utils";
import type { CommunityDispatchRequestDoc } from "./community-dispatch-request-types";
import {
  buildCommunityChannelContact,
  readCommunityCustomerContact,
  type CommunityChannelContact,
} from "./community-channel-contact";
import { sendCommunityChannelText } from "./community-channel-outbound-service";
import {
  loadCommunityDeliveryReceiptContext,
  markCommunityDeliveryNotified,
  maybeSendCommunityReceiptEmail,
  sendCommunityMessengerReceiptBundle,
} from "./community-messenger-delivery-receipt-service";

export function buildCommunityOrderSummaryMessage(params: {
  fields: import("./community-dispatch-template-parser").CommunityOrderFields;
  referenceId: string;
  geocode?: import("./community-dispatch-request-types").CommunityDispatchGeocode;
  stationName?: string;
}): string {
  const deliveryLabel = params.fields.delivery ? "Delivery" : "Pickup";
  const lines = [
    "Thank you — your order has been received. ✨",
    "",
    `Reference: ${params.referenceId}`,
    "",
    "Here's what we captured:",
    `• Name: ${params.fields.name}`,
    `• ${deliveryLabel}: ${params.fields.qty} gal`,
    `• Mobile: ${params.fields.number}`,
  ];

  if (params.geocode?.formattedAddress) {
    lines.push(`• Location verified: ${params.geocode.formattedAddress}`);
  }
  if (params.stationName) {
    lines.push(`• Station: ${params.stationName}`);
  }

  lines.push("", "Salamat po for choosing River Smart Refill! 💧");
  return lines.join("\n");
}

/** Shown on ack / expand messages — cancel only while waiting for accept. */
export const COMMUNITY_CANCEL_WHILE_WAITING_HINT =
  "While waiting for a station to accept, reply CANCEL to cancel this request.";

/** Customer ack after order — nearby WRS count; first station to accept wins. */
export function buildCommunityNearbyStationsAckMessage(params: {
  referenceId: string;
  nearbyCount: number;
  searchRadiusKm: number;
  offerResponseMinutes?: number;
}): string {
  const count = Math.max(0, params.nearbyCount);
  const stationLabel = count === 1 ? "station" : "stations";
  const verb = count === 1 ? "can" : "can";
  const waitMinutes = params.offerResponseMinutes ?? COMMUNITY_OFFER_RESPONSE_MINUTES;
  const radius = params.searchRadiusKm;

  return [
    "Thank you — we received your order! ✨",
    "",
    `Reference: ${params.referenceId}`,
    "",
    `Current search radius: ${radius} km`,
    "",
    count > 0 ?
      `${count} nearby refilling ${stationLabel} ${verb} serve your location within ${radius} km.` :
      `We're searching for refilling stations within ${radius} km of your location.`,
    "",
    `We've notified them now — please wait up to ${waitMinutes} minutes for a station to accept your order.`,
    "The first station to accept will confirm your order and send your tracking link.",
    "",
    COMMUNITY_CANCEL_WHILE_WAITING_HINT,
    "",
    "Salamat po! 🙏",
  ].join("\n");
}

export function buildCommunitySearchRadiusExpandMessage(params: {
  referenceId: string;
  fromRadiusKm: number;
  toRadiusKm: number;
  reason: "no_stations" | "no_accept";
  nearbyCount?: number;
}): string {
  const reasonLine =
    params.reason === "no_stations" ?
      `No refilling stations were found within ${params.fromRadiusKm} km of your location yet.` :
      `No station has accepted your order within ${params.fromRadiusKm} km yet.`;

  const nextLine =
    params.nearbyCount != null && params.nearbyCount > 0 ?
      `We found ${params.nearbyCount} station${params.nearbyCount === 1 ? "" : "s"} within ${params.toRadiusKm} km and notified them now.` :
      `We're now searching within ${params.toRadiusKm} km.`;

  return [
    "Update on your order ✨",
    "",
    `Reference: ${params.referenceId}`,
    "",
    reasonLine,
    `Expanding search to ${params.toRadiusKm} km.`,
    "",
    nextLine,
    "",
    `Current search radius: ${params.toRadiusKm} km`,
    "",
    COMMUNITY_CANCEL_WHILE_WAITING_HINT,
    "",
    "Salamat po! 🙏",
  ].join("\n");
}

/** No WRS found in any search radius (5 / 10 / 15 km). */
export function buildCommunityFinalNoWrsMessage(referenceId: string): string {
  return [
    "We're sorry — we couldn't find a refilling station near your location right now.",
    "",
    `Reference: ${referenceId}`,
    "",
    "We searched within 5 km, then 10 km, and up to 15 km from your delivery location, but no eligible stations are available in your area yet.",
    "",
    "Please try again next time — we're growing our partner network and hope to serve you soon.",
    "",
    "Salamat po for choosing River Smart Refill! 🙏",
  ].join("\n");
}

/** Stations were found but none accepted within the search window. */
export function buildCommunityFinalBusyMessage(referenceId: string): string {
  return [
    "We're sorry — nearby refilling stations may be busy at the moment.",
    "",
    `Reference: ${referenceId}`,
    "",
    "We searched within 5 km, then 10 km, and up to 15 km, and notified eligible stations, but none could accept your order in time.",
    "",
    "Please try again a little later — salamat po for your patience! 🙏",
  ].join("\n");
}

/** @deprecated Use buildCommunityFinalBusyMessage. */
export function buildCommunityDispatchExhaustedMessage(referenceId: string): string {
  return buildCommunityFinalBusyMessage(referenceId);
}

export function buildCommunityOrderCancelledMessage(referenceId: string): string {
  return [
    "Your order request has been cancelled.",
    "",
    `Reference: ${referenceId}`,
    "",
    "No station had accepted yet, so nothing was charged or assigned.",
    "",
    "You can send a new order anytime when you're ready. Salamat po! 🙏",
  ].join("\n");
}

export function buildCommunityOrderTrackUrl(params: {
  businessId: string;
  referenceId: string;
}): string {
  const base = resolveAppBaseUrlForEmail();
  const query = new URLSearchParams({
    b: params.businessId,
    ref: params.referenceId,
  });
  return `${base}/order?${query.toString()}`;
}

export function buildCommunityOrderAcceptedMessage(params: {
  stationName: string;
  referenceId: string;
  trackUrl: string;
  fields?: import("./community-dispatch-template-parser").CommunityOrderFields;
  geocode?: import("./community-dispatch-request-types").CommunityDispatchGeocode;
  distanceKm?: number;
  etaMinutes?: number;
}): string {
  const delivery = params.fields?.delivery !== false;
  const lines = [
    "Great news — your order has been accepted! ✨",
    "",
    `Station: ${params.stationName}`,
    `Reference: ${params.referenceId}`,
    "",
  ];

  if (params.fields?.name) {
    lines.push("Order summary:");
    lines.push(`• Name: ${params.fields.name}`);
    lines.push(`• ${delivery ? "Delivery" : "Pickup"}: ${params.fields.qty ?? "—"} gal`);
    if (params.fields.number) {
      lines.push(`• Mobile: ${params.fields.number}`);
    }
    if (params.geocode?.formattedAddress) {
      lines.push(`• Location: ${params.geocode.formattedAddress}`);
    } else if (params.fields.location?.trim()) {
      lines.push(`• Location: ${params.fields.location.trim()}`);
    }
    lines.push("");
  }

  if (params.distanceKm != null) {
    lines.push(`Distance from station: ${formatDistanceKmForMessenger(params.distanceKm)}`);
  }

  if (params.etaMinutes != null) {
    const etaLabel = formatEtaMinutesForMessenger(params.etaMinutes);
    lines.push(
      delivery ?
        `Estimated delivery: ${etaLabel}` :
        `Estimated ready for pickup: ${etaLabel}`,
    );
  }

  lines.push(
    "",
    "Tap the link below to open your order page and track delivery:",
    params.trackUrl,
    "",
    "Salamat po for choosing River Smart Refill! 💧",
  );

  return lines.join("\n");
}

export function resolveCommunityOrderAcceptedMetrics(params: {
  request: CommunityDispatchRequestDoc;
  stationLat: number;
  stationLng: number;
}): { distanceKm: number; etaMinutes: number } | null {
  const geocode = params.request.geocode;
  if (!geocode) return null;

  const distanceKm = haversineDistanceKm(
    geocode.latitude,
    geocode.longitude,
    params.stationLat,
    params.stationLng,
  );

  const delivery = params.request.parsed?.delivery !== false;
  const etaMinutes = delivery ?
    estimateCommunityDeliveryEtaMinutes(distanceKm) :
    estimateCommunityPickupReadyMinutes();

  return { distanceKm, etaMinutes };
}

export type CommunityOrderPaymentReminder = "none" | "unpaid" | "partial";

export function resolveCommunityOrderPaymentReminder(
  paymentStatus: string | null | undefined,
): CommunityOrderPaymentReminder {
  const normalized = (paymentStatus || "").trim().toLowerCase();
  if (normalized === "unpaid") return "unpaid";
  if (normalized === "partial") return "partial";
  return "none";
}

function formatMessengerPeso(amount: number): string {
  return `₱${amount.toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export type CommunityReceiptDeliveryChannel = "email" | "messenger";

export function buildCommunityDeliveryCompleteMessage(params: {
  referenceId: string;
  trackUrl: string;
  paymentReminder?: CommunityOrderPaymentReminder;
  balanceDue?: number;
  receiptChannel?: CommunityReceiptDeliveryChannel;
  receiptEmail?: string;
}): string {
  const paymentReminder = params.paymentReminder ?? "none";
  const receiptChannel = params.receiptChannel ?? "messenger";
  const lines = [
    "Your delivery is complete! 🎉",
    "",
    `Reference: ${params.referenceId}`,
    "",
  ];

  if (paymentReminder === "unpaid") {
    lines.push(
      "Please confirm receipt, rate your experience, and pay your order using your order tracker:",
    );
  } else if (paymentReminder === "partial") {
    const balanceHint =
      params.balanceDue != null && params.balanceDue > 0 ?
        ` (${formatMessengerPeso(params.balanceDue)} balance remaining)` :
        "";
    lines.push(
      `Please confirm receipt, rate your experience, and pay your remaining balance${balanceHint} using your order tracker:`,
    );
  } else {
    lines.push(
      "Please confirm receipt and rate your experience using your order tracker:",
    );
  }

  lines.push(params.trackUrl, "");

  if (receiptChannel === "email" && params.receiptEmail?.trim()) {
    lines.push(
      "Your official receipt will be sent to the email you provided:",
      `• ${params.receiptEmail.trim()}`,
      "",
    );
  } else {
    lines.push(
      "Your official receipt will follow here in Messenger shortly.",
      "",
    );
  }

  lines.push("Salamat po — we hope you enjoy your refill! 💧");

  return lines.join("\n");
}

export type CommunityMessengerNotifyResult = { ok: true } | { ok: false; reason: string };

function resolveNotifyContact(params: {
  contact?: CommunityChannelContact;
  psid?: string;
  sourceChannel?: CommunityChannelContact["sourceChannel"];
  request?: CommunityDispatchRequestDoc;
}): CommunityChannelContact | null {
  if (params.contact) return params.contact;
  if (params.request) {
    return readCommunityCustomerContact(params.request);
  }
  const psid = params.psid?.trim();
  if (!psid) return null;
  return buildCommunityChannelContact({
    sourceChannel: params.sourceChannel ?? "community_messenger",
    contactId: psid,
  });
}

export async function notifyCommunityOrderAccepted(params: {
  contact?: CommunityChannelContact;
  psid?: string;
  sourceChannel?: CommunityChannelContact["sourceChannel"];
  businessId: string;
  stationName: string;
  referenceId: string;
  request?: CommunityDispatchRequestDoc;
  distanceKm?: number;
  etaMinutes?: number;
}): Promise<CommunityMessengerNotifyResult> {
  const contact = resolveNotifyContact(params);
  if (!contact) {
    return { ok: false, reason: "missing_contact" };
  }

  const trackUrl = buildCommunityOrderTrackUrl({
    businessId: params.businessId,
    referenceId: params.referenceId,
  });
  const message = buildCommunityOrderAcceptedMessage({
    stationName: params.stationName,
    referenceId: params.referenceId,
    trackUrl,
    fields: params.request?.parsed,
    geocode: params.request?.geocode,
    distanceKm: params.distanceKm,
    etaMinutes: params.etaMinutes,
  });

  const result = await sendCommunityChannelText(contact, message);
  if (!result.ok) {
    logger.warn("notifyCommunityOrderAccepted send_failed", {
      contactId: contact.contactId,
      channel: contact.sourceChannel,
      reason: result.reason,
    });
    return { ok: false, reason: result.reason };
  }

  return { ok: true };
}

export async function notifyCommunityDispatchFinalized(params: {
  contact?: CommunityChannelContact;
  psid?: string;
  sourceChannel?: CommunityChannelContact["sourceChannel"];
  referenceId: string;
  stationsFoundEver: boolean;
}): Promise<void> {
  const contact = resolveNotifyContact(params);
  if (!contact) return;

  const message = params.stationsFoundEver ?
    buildCommunityFinalBusyMessage(params.referenceId) :
    buildCommunityFinalNoWrsMessage(params.referenceId);
  const result = await sendCommunityChannelText(contact, message);
  if (!result.ok) {
    logger.warn("notifyCommunityDispatchFinalized send_failed", {
      contactId: contact.contactId,
      reason: result.reason,
    });
  }
}

/** @deprecated Use notifyCommunityDispatchFinalized. */
export async function notifyCommunityDispatchExhausted(params: {
  contact?: CommunityChannelContact;
  psid?: string;
  referenceId: string;
}): Promise<void> {
  await notifyCommunityDispatchFinalized({
    contact: params.contact,
    psid: params.psid,
    referenceId: params.referenceId,
    stationsFoundEver: true,
  });
}

/** Delivery done Messenger nudge + receipt routing (email vs Messenger). */
export async function maybeSendCommunityMessengerDeliveryComplete(params: {
  businessId: string;
  referenceId: string;
  paymentStatus?: string | null;
  balanceDue?: number | null;
}): Promise<void> {
  const context = await loadCommunityDeliveryReceiptContext({
    businessId: params.businessId,
    referenceId: params.referenceId,
  });
  if (!context) return;

  const trackUrl = buildCommunityOrderTrackUrl({
    businessId: params.businessId,
    referenceId: params.referenceId,
  });

  const paymentReminder = resolveCommunityOrderPaymentReminder(params.paymentStatus);
  const balanceDue =
    params.balanceDue != null && Number.isFinite(params.balanceDue) ?
      Math.max(0, params.balanceDue) :
      undefined;

  const receiptChannel = context.receiptEmail ? "email" : "messenger";

  const statusResult = await sendCommunityChannelText(
    buildCommunityChannelContact({
      sourceChannel: context.sourceChannel ?? "community_messenger",
      contactId: context.psid,
    }),
    buildCommunityDeliveryCompleteMessage({
      referenceId: params.referenceId,
      trackUrl,
      paymentReminder,
      balanceDue,
      receiptChannel,
      receiptEmail: context.receiptEmail ?? undefined,
    }),
  );

  if (!statusResult.ok) {
    logger.warn("community_messenger_delivery_status_failed", {
      businessId: params.businessId,
      referenceId: params.referenceId,
      reason: statusResult.reason,
    });
    return;
  }

  if (
    receiptChannel === "email" &&
    context.receiptEmail &&
    context.transaction &&
    context.customer
  ) {
    await maybeSendCommunityReceiptEmail({
      businessId: params.businessId,
      transaction: context.transaction,
      customer: context.customer,
      recipientEmail: context.receiptEmail,
    });
    await markCommunityDeliveryNotified(context.requestDocRef, {
      deliveryReceiptChannel: "email",
      deliveryReceiptEmail: context.receiptEmail,
    });
    return;
  }

  if (context.transaction && context.customer) {
    const receiptResult = await sendCommunityMessengerReceiptBundle({
      psid: context.psid,
      businessId: params.businessId,
      transaction: context.transaction,
      customer: context.customer,
    });
    if (!receiptResult.ok) {
      logger.warn("community_messenger_receipt_bundle_failed", {
        businessId: params.businessId,
        referenceId: params.referenceId,
        reason: receiptResult.reason,
      });
    }
    await markCommunityDeliveryNotified(context.requestDocRef, {
      deliveryReceiptChannel: "messenger",
      deliveryReceiptMessengerOk: receiptResult.ok,
      ...(receiptResult.reason ? { deliveryReceiptMessengerError: receiptResult.reason } : {}),
    });
    return;
  }

  await markCommunityDeliveryNotified(context.requestDocRef, {
    deliveryReceiptChannel: receiptChannel,
    deliveryReceiptSkippedReason: "missing_transaction_or_customer",
  });
}
