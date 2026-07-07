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
import { sendCommunityDeliveryChatDiscoveryButton, closeDeliveryChatOnOrderComplete } from "./delivery-messenger-chat-service";
import {
  loadCommunityDeliveryReceiptContext,
  markCommunityDeliveryNotified,
  maybeSendCommunityReceiptEmail,
  sendCommunityMessengerReceiptBundle,
} from "./community-messenger-delivery-receipt-service";

import {
  formatCommunityOrderLines,
  type CommunityOrderFields,
} from "./community-dispatch-template-parser";
import {
  COMMUNITY_ORDER_AGAIN_HINT,
  COMMUNITY_PRICE_BEFORE_ACCEPT_HINT,
} from "./community-messenger-copy";

/** Minutes after offers go out before a gentle wait nudge (before radius expand). */
export const COMMUNITY_WAIT_NUDGE_AFTER_MINUTES = 2;

export type CommunityMessengerNotifyResult = { ok: true } | { ok: false; reason: string };

export function buildCommunityOrderSummaryMessage(params: {
  fields: CommunityOrderFields;
  referenceId: string;
  geocode?: import("./community-dispatch-request-types").CommunityDispatchGeocode;
  stationName?: string;
}): string {
  const lines = [
    "Salamat po — natanggap na ang order mo! ✨",
    "",
    `Reference: ${params.referenceId}`,
    "",
    "Narito ang na-save namin:",
    `• Name: ${params.fields.name}`,
  ];

  if (params.fields.orderLines?.length) {
    lines.push(`• Order: ${formatCommunityOrderLines(params.fields.orderLines)}`);
    lines.push(`• Total: ${params.fields.qty ?? "—"} container(s)`);
  } else {
    const deliveryLabel = params.fields.delivery ? "Delivery" : "Pickup";
    lines.push(`• ${deliveryLabel}: ${params.fields.qty} gal`);
  }

  if (params.fields.number) {
    lines.push(`• Number: ${params.fields.number}`);
  }

  if (params.geocode?.formattedAddress) {
    lines.push(`• Address (verified): ${params.geocode.formattedAddress}`);
  }
  if (params.stationName) {
    lines.push(`• Station: ${params.stationName}`);
  }

  lines.push("", "Salamat po sa River Smart Refill! 💧");
  return lines.join("\n");
}

/** Shown on ack / expand messages — encourage waiting; cancel requires a reason. */
export const COMMUNITY_CANCEL_WHILE_WAITING_HINT = [
  "Sandali lang po — hinihintay natin na may tumanggap ng order mo.",
  "Kung kailangan i-cancel: CANCEL - {reason}",
].join("\n");

/** Prompt when customer sends CANCEL without a reason. */
export function buildCommunityCancelReasonRequiredMessage(referenceId?: string): string {
  const lines = [
    "Para ma-cancel, pakilagay ang reason sa format na ito:",
    "",
    "CANCEL - {reason}",
    "",
    "Halimbawa: CANCEL - may mas malapit na station",
    "",
  ];

  if (referenceId?.trim()) {
    lines.unshift(`Reference: ${referenceId.trim()}`, "");
  }

  lines.push(
    "Hintayin lang po — wala pang tumatanggap. Salamat sa pasensya! 🙏",
  );

  return lines.join("\n");
}

/** Soft reminder while still waiting for first station accept. */
export function buildCommunityWaitNudgeMessage(referenceId: string): string {
  return [
    "Quick update ✨",
    "",
    `Reference: ${referenceId}`,
    "",
    "Hinahanap pa namin ang station na tatanggap ng order mo. Sandali lang po — usually within a few minutes.",
    "",
    COMMUNITY_CANCEL_WHILE_WAITING_HINT,
    "",
    "Salamat po! 🙏",
  ].join("\n");
}

/** Customer ack after order — nearby WRS count; first station to accept wins. */
export function buildCommunityNearbyStationsAckMessage(params: {
  referenceId: string;
  nearbyCount: number;
  searchRadiusKm: number;
  offerResponseMinutes?: number;
}): string {
  const count = Math.max(0, params.nearbyCount);
  const stationLabel = count === 1 ? "station" : "stations";
  const waitMinutes = params.offerResponseMinutes ?? COMMUNITY_OFFER_RESPONSE_MINUTES;
  const radius = params.searchRadiusKm;

  return [
    "Salamat po — natanggap na ang order mo! ✨",
    "",
    `Reference: ${params.referenceId}`,
    "",
    `Hinahanap sa loob ng ${radius} km ang location mo.`,
    "",
    count > 0 ?
      `${count} malapit na ${stationLabel} ang pinadalhan namin ng order mo.` :
      `Naghahanap pa kami ng stations within ${radius} km.`,
    "",
    `Hintayin lang po hanggang ${waitMinutes} min — unang tumanggap ang kukuha ng order.`,
    "Pag may tumanggap, papadalhan ka namin ng tracking link.",
    "",
    COMMUNITY_PRICE_BEFORE_ACCEPT_HINT,
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
      `Walang station within ${params.fromRadiusKm} km pa.` :
      `Walang tumanggap within ${params.fromRadiusKm} km pa.`;

  const nextLine =
    params.nearbyCount != null && params.nearbyCount > 0 ?
      `May ${params.nearbyCount} station within ${params.toRadiusKm} km — pinadalhan na namin sila.` :
      `Naghahanap na kami within ${params.toRadiusKm} km.`;

  return [
    "Update sa order mo ✨",
    "",
    `Reference: ${params.referenceId}`,
    "",
    reasonLine,
    `Lalakihan namin ang search to ${params.toRadiusKm} km.`,
    "",
    nextLine,
    "",
    COMMUNITY_CANCEL_WHILE_WAITING_HINT,
    "",
    "Salamat po! 🙏",
  ].join("\n");
}

/** No WRS found in any search radius (5 / 10 / 15 km). */
export function buildCommunityFinalNoWrsMessage(referenceId: string): string {
  return [
    "Pasensya na po — walang station malapit sa location mo ngayon.",
    "",
    `Reference: ${referenceId}`,
    "",
    "Tinry namin sa 5 km, 10 km, at hanggang 15 km — wala pa kaming partner doon.",
    "",
    COMMUNITY_ORDER_AGAIN_HINT,
    "",
    "Salamat po! 🙏",
  ].join("\n");
}

/** Stations were found but none accepted within the search window. */
export function buildCommunityFinalBusyMessage(referenceId: string): string {
  return [
    "Pasensya na po — busy ang mga malapit na stations ngayon.",
    "",
    `Reference: ${referenceId}`,
    "",
    "Tinry namin sa 5 km, 10 km, at 15 km, pero walang nakapag-accept in time.",
    "",
    COMMUNITY_ORDER_AGAIN_HINT,
    "",
    "Salamat po sa pasensya! 🙏",
  ].join("\n");
}

/** @deprecated Use buildCommunityFinalBusyMessage. */
export function buildCommunityDispatchExhaustedMessage(referenceId: string): string {
  return buildCommunityFinalBusyMessage(referenceId);
}

export function buildCommunityOrderCancelledMessage(referenceId: string): string {
  return [
    "Na-cancel na ang order request mo.",
    "",
    `Reference: ${referenceId}`,
    "",
    "Wala pang tumanggap, kaya walang charge o assignment.",
    "",
    COMMUNITY_ORDER_AGAIN_HINT,
    "",
    "Salamat po! 🙏",
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
    "Good news — may tumanggap na ng order mo! ✨",
    "",
    `Station: ${params.stationName}`,
    `Reference: ${params.referenceId}`,
    "",
  ];

  if (params.fields?.name) {
    lines.push("Order mo:");
    lines.push(`• Name: ${params.fields.name}`);
    if (params.fields.orderLines?.length) {
      lines.push(`• Order: ${formatCommunityOrderLines(params.fields.orderLines)}`);
      lines.push(`• Total: ${params.fields.qty ?? "—"} container(s)`);
    } else {
      lines.push(`• ${delivery ? "Delivery" : "Pickup"}: ${params.fields.qty ?? "—"} gal`);
    }
    if (params.fields.number) {
      lines.push(`• Number: ${params.fields.number}`);
    }
    if (params.geocode?.formattedAddress) {
      lines.push(`• Address: ${params.geocode.formattedAddress}`);
    } else if (params.fields.location?.trim()) {
      lines.push(`• Address: ${params.fields.location.trim()}`);
    }
    lines.push("");
  }

  if (params.distanceKm != null) {
    lines.push(`Layo mula sa station: ${formatDistanceKmForMessenger(params.distanceKm)}`);
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
    "Buksan ang link para i-track ang delivery mo:",
    params.trackUrl,
    "",
    "Salamat po! 💧",
  );

  return lines.join("\n");
}

/** On the way — sent when station marks order in-transit. */
export function buildCommunityOrderInTransitMessage(params: {
  referenceId: string;
  trackUrl: string;
  riderName?: string;
}): string {
  const riderLine = params.riderName?.trim() ?
    `Rider: ${params.riderName.trim()}` :
    "Papunta na ang delivery mo.";

  return [
    "Update sa order mo! 🚚",
    "",
    `Reference: ${params.referenceId}`,
    "",
    riderLine,
    "",
    "Track dito:",
    params.trackUrl,
    "",
    "Salamat po! 🙏",
  ].join("\n");
}

export async function notifyCommunityOrderInTransit(params: {
  businessId: string;
  referenceId: string;
  riderName?: string;
}): Promise<CommunityMessengerNotifyResult> {
  const context = await loadCommunityDeliveryReceiptContext({
    businessId: params.businessId,
    referenceId: params.referenceId,
  });
  if (!context) {
    return { ok: false, reason: "not_community_order" };
  }

  const contact = buildCommunityChannelContact({
    sourceChannel: context.sourceChannel ?? "community_messenger",
    contactId: context.psid,
  });
  const trackUrl = buildCommunityOrderTrackUrl({
    businessId: params.businessId,
    referenceId: params.referenceId,
  });
  const message = buildCommunityOrderInTransitMessage({
    referenceId: params.referenceId,
    trackUrl,
    riderName: params.riderName,
  });

  const result = await sendCommunityChannelText(contact, message);
  if (!result.ok) {
    logger.warn("notifyCommunityOrderInTransit send_failed", {
      referenceId: params.referenceId,
      reason: result.reason,
    });
    return { ok: false, reason: result.reason };
  }

  await sendCommunityDeliveryChatDiscoveryButton(contact);

  return { ok: true };
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
    "Tapos na ang delivery mo! 🎉",
    "",
    `Reference: ${params.referenceId}`,
    "",
  ];

  if (paymentReminder === "unpaid") {
    lines.push(
      "Pakiconfirm na natanggap mo, mag-rate, at magbayad sa order tracker:",
    );
  } else if (paymentReminder === "partial") {
    const balanceHint =
      params.balanceDue != null && params.balanceDue > 0 ?
        ` (${formatMessengerPeso(params.balanceDue)} balance pa)` :
        "";
    lines.push(
      `Pakiconfirm na natanggap mo, mag-rate, at bayaran ang natitira${balanceHint} sa order tracker:`,
    );
  } else {
    lines.push(
      "Pakiconfirm na natanggap mo at mag-rate sa order tracker:",
    );
  }

  lines.push(params.trackUrl, "");

  if (receiptChannel === "email" && params.receiptEmail?.trim()) {
    lines.push(
      "Ipapadala ang official receipt sa email mo:",
      `• ${params.receiptEmail.trim()}`,
      "",
    );
  } else {
    lines.push(
      "Ipapadala ang official receipt dito sa Messenger.",
      "",
    );
  }

  lines.push("Salamat po — enjoy your refill! 💧");

  return lines.join("\n");
}

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

  await sendCommunityDeliveryChatDiscoveryButton(contact);

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

  await closeDeliveryChatOnOrderComplete({
    businessId: params.businessId,
    referenceId: params.referenceId,
  }).catch((err) => {
    logger.warn("delivery_chat_close_on_complete_failed", {
      businessId: params.businessId,
      referenceId: params.referenceId,
      err,
    });
  });

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
