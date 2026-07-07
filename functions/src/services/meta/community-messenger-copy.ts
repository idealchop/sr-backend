/** Short note while order is still being fixed — not yet sent to stations. */
export const COMMUNITY_ORDER_IN_PROGRESS_NOTE =
  "Note: Inaayos pa ang order mo — hindi pa ito pinapadala sa mga station.";

/** Shown after terminal failures — how to order again. */
export const COMMUNITY_ORDER_AGAIN_HINT =
  "Mag-order ulit anytime — pili lang ng Water Delivery o mag-hi sa amin.";

/** Price expectation before a station accepts. */
export const COMMUNITY_PRICE_BEFORE_ACCEPT_HINT =
  "Presyo: makikita mo sa order page kapag may tumanggap na ng order mo.";

/** Optional contact fields on the form. */
export const COMMUNITY_OPTIONAL_CONTACT_HINT =
  "Email at Number — optional lang. Pwede iwan blank o type \"none\".";

/** Hint on accepted / in-transit messages — station delivery chat (not Inquiry). */
export const COMMUNITY_DELIVERY_CHAT_HINT =
  "May tanong sa delivery? I-send CHAT para makausap ang station. CLOSE CHAT pag tapos na.";

export function buildCommunityDeliveryChatOpenedMessage(params: {
  stationName: string;
  referenceId: string;
}): string {
  return [
    `Chat open kay ${params.stationName}.`,
    "",
    `Reference: ${params.referenceId}`,
    "",
    "Reply freely — makikita ng station ang message mo.",
    "CLOSE CHAT pag tapos na.",
    "",
    "Salamat po! 🙏",
  ].join("\n");
}

export function buildCommunityDeliveryChatClosedMessage(): string {
  return [
    "Delivery chat closed.",
    "",
    "I-send CHAT ulit kung kailangan makausap ang station habang active pa ang order.",
    "",
    "Salamat po! 🙏",
  ].join("\n");
}

export function buildCommunityDeliveryChatClosedOnCompleteMessage(params: {
  referenceId: string;
}): string {
  return [
    "Tapos na ang delivery — sarado na ang chat.",
    "",
    `Reference: ${params.referenceId}`,
    "",
    "Salamat po sa order mo! 💧",
  ].join("\n");
}

export function buildCommunityStationInitiatedChatMessage(params: {
  stationName: string;
  referenceId: string;
}): string {
  return [
    `Message from ${params.stationName} about your order.`,
    "",
    `Reference: ${params.referenceId}`,
    "",
    "Reply freely o i-send CHAT anytime habang active pa ang delivery.",
    "CLOSE CHAT pag tapos na.",
    "",
    "Salamat po! 🙏",
  ].join("\n");
}

export function buildCommunityDeliveryChatUnavailableMessage(): string {
  return [
    "Walang active delivery na pwedeng i-chat ngayon.",
    "",
    "Gamitin Inquiry / Others kung general question.",
    "",
    "Salamat po! 🙏",
  ].join("\n");
}

export function buildCommunityCancelNotAvailableAcceptedMessage(params: {
  referenceId: string;
}): string {
  return [
    "Tumanggap na ang station ng order mo — hindi na pwede i-cancel dito.",
    "",
    `Reference: ${params.referenceId}`,
    "",
    "I-send CHAT para makausap ang station kung may concern.",
    "",
    "Salamat po! 🙏",
  ].join("\n");
}

/** After 24h idle with a draft order saved. */
export function buildCommunityPendingOrderResumeHint(): string {
  return [
    "May order ka pa na hindi tapos from last time.",
    "",
    "Pili lang ulit ng Water Delivery para ituloy.",
    "",
    "Salamat po! 🙏",
  ].join("\n");
}

export type CommunityActiveOrderBlockedPhase =
  | "waiting_station"
  | "in_delivery"
  | "needs_address";

/** Shown when customer tries to start another delivery while one is still open. */
export function buildCommunityActiveOrderBlockedMessage(params: {
  referenceId: string;
  phase: CommunityActiveOrderBlockedPhase;
}): string {
  const refLine = `Reference: ${params.referenceId}`;

  if (params.phase === "needs_address") {
    return [
      "May order ka pa na hindi tapos.",
      "",
      refLine,
      "",
      "Paki-send muna ang tamang address para matuloy ang order na iyon.",
      "Hindi pa pwede mag-start ng bagong order habang open pa ito.",
      "",
      "May tanong? Pili Inquiry / Others.",
      "",
      "Salamat po! 🙏",
    ].join("\n");
  }

  if (params.phase === "in_delivery") {
    return [
      "May active order ka pa — in progress pa ang delivery mo.",
      "",
      refLine,
      "",
      "Hintayin lang po matapos ito bago mag-order ulit.",
      "Gamitin ang tracking link sa last message namin, kung meron.",
      "",
      COMMUNITY_DELIVERY_CHAT_HINT,
      "",
      "Salamat po! 🙏",
    ].join("\n");
  }

  return [
    "May active order ka pa — hinihintay pa ang station.",
    "",
    refLine,
    "",
    "Hintayin lang po matapos ito bago mag-order ulit.",
    "Kung kailangan i-cancel: CANCEL - {reason}",
    "",
    "May tanong habang naghihintay? Pili Inquiry / Others.",
    "",
    "Salamat po! 🙏",
  ].join("\n");
}
