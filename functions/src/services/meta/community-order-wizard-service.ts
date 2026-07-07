import { logger } from "../observability/logging/logger";
import type { CommunityChannelContact } from "./community-channel-contact";
import { sendCommunityChannelButtons, sendCommunityChannelText } from "./community-channel-outbound-service";
import type { CommunityOrderFields } from "./community-dispatch-template-parser";
import {
  parseCommunityOrderTemplate,
  validateCommunityOrderFields,
} from "./community-dispatch-template-parser";
import {
  COMMUNITY_DELIVERY_CHAT_HINT,
  buildCommunityPendingOrderResumeHint } from "./community-messenger-copy";
import {
  buildCommunityInquiryHandoffMessage,
  buildCommunityOrderFormExampleMessage,
  buildCommunityOrderFormMessage,
  buildCommunityServiceChoicePrompt,
  buildCommunityServiceChoiceReminder,
  buildCommunityWaterDeliveryIntroMessage,
  buildCommunityWelcomeMessage,
  META_POSTBACK_ORDER_CONFIRM_NO,
  META_POSTBACK_ORDER_CONFIRM_YES,
  META_POSTBACK_ORDER_FORM,
  META_POSTBACK_DELIVERY_CHAT,
  META_POSTBACK_SERVICE_INQUIRY,
  META_POSTBACK_SERVICE_WATER_DELIVERY,
  META_POSTBACK_WIZARD_DELIVERY_NO,
  META_POSTBACK_WIZARD_DELIVERY_YES,
  META_POSTBACK_WIZARD_START,
} from "./community-order-template";
import {
  buildCommunityAddressRepairMessage,
  buildCommunityClarificationMessage,
  buildCommunityOrderConfirmSummary,
  buildCommunityOrderEditPromptMessage,
  buildCommunityOrderFormatRepairMessage,
} from "./community-order-reply-service";
import {
  blockIfActiveCommunityOrder,
  findActiveCommunityOrderForContact,
} from "./community-active-order-guard-service";
import { openDeliveryChatFromCustomerAction } from "./delivery-messenger-chat-intake-service";
import {
  clearCommunityPendingOrderIntent,
  loadCommunityPendingOrderIntent,
  saveCommunityPendingOrderIntent,
  clearCommunityMessengerServiceMode,
  getCommunityMessengerServiceMode,
  hasCommunityMessengerContact,
  isCommunityMessengerSessionExpired,
  markCommunityMessengerContactGreeted,
  setCommunityMessengerServiceMode,
  touchCommunityMessengerInboundActivity,
  type CommunityPendingOrderIntent,
} from "./community-messenger-contact-registry";
import {
  ensureCommunityInquiryThreadOpen,
  recordCommunityInquiryInboundMessage,
} from "./community-messenger-inquiry-service";
import {
  clearCommunityMessengerSession,
  getCommunityMessengerSession,
  mergeDefinedFields,
  saveCommunityMessengerSession,
  type CommunityMessengerSession,
  type CommunityMessengerWizardStep,
} from "./community-messenger-session-service";

/**
 * Step-by-step wizard (WIZARD_START) is internal-only — not shown in the Water Delivery
 * button flow. Form copy-paste is the primary order path for community Messenger.
 */

function sessionHasOrderProgress(session: CommunityMessengerSession | null): boolean {
  if (!session) return false;
  return Boolean(
    session.missingFields?.length ||
    session.repairAwait ||
    session.awaitingConfirmation ||
    session.fields?.name?.trim() ||
    session.fields?.location?.trim() ||
    session.fields?.orderRaw?.trim() ||
    session.fields?.orderLines?.length,
  );
}

function sessionToPendingIntent(session: CommunityMessengerSession): CommunityPendingOrderIntent {
  return {
    fields: session.fields,
    ...(session.missingFields?.length ? { missingFields: session.missingFields } : {}),
    ...(session.repairAwait ? { repairAwait: session.repairAwait } : {}),
    ...(session.awaitingConfirmation === "order" ?
      { awaitingConfirmation: "order" as const } :
      {}),
  };
}

async function restorePendingOrderSession(
  contact: CommunityChannelContact,
  intent: CommunityPendingOrderIntent,
): Promise<void> {
  const key = sessionKey(contact);
  await saveCommunityMessengerSession({
    psid: key,
    sourceChannel: contact.sourceChannel,
    fields: intent.fields,
    rawMessage: "[restored pending order]",
    flow: "template",
    ...(intent.missingFields?.length ? { missingFields: intent.missingFields } : {}),
    ...(intent.repairAwait ? { repairAwait: intent.repairAwait } : {}),
    ...(intent.awaitingConfirmation ? { awaitingConfirmation: intent.awaitingConfirmation } : {}),
    ...(intent.awaitingConfirmation ? { wizardStep: "confirm" as const } : {}),
  });

  if (intent.awaitingConfirmation === "order") {
    await sendCommunityOrderConfirmPrompt(contact, intent.fields);
    return;
  }
  if (intent.repairAwait === "address") {
    await sendWizardMessage(
      contact,
      buildCommunityAddressRepairMessage(intent.fields.location),
      "pending_restore_address",
    );
    return;
  }
  if (intent.repairAwait === "order") {
    await sendWizardMessage(
      contact,
      buildCommunityOrderFormatRepairMessage(intent.fields.orderRaw),
      "pending_restore_order",
    );
    return;
  }
  if (intent.missingFields?.length) {
    await sendWizardMessage(
      contact,
      buildCommunityClarificationMessage(intent.missingFields, intent.fields),
      "pending_restore_missing",
    );
  }
}

function sessionKey(contact: CommunityChannelContact): string {
  return contact.contactId;
}

function parseWizardQty(text: string): number | undefined {
  const match = text.trim().match(/(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n);
}

function parseWizardPhone(text: string): string | undefined {
  const digits = text.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return undefined;
  return text.trim().slice(0, 40);
}

async function sendWizardMessage(
  contact: CommunityChannelContact,
  message: string,
  context: string,
): Promise<void> {
  const result = await sendCommunityChannelText(contact, message);
  if (!result.ok) {
    logger.warn("communityOrderWizard send_failed", {
      contactId: contact.contactId,
      channel: contact.sourceChannel,
      context,
      reason: result.reason,
    });
  }
}

function nextWizardStep(
  fields: CommunityOrderFields,
  current?: CommunityMessengerWizardStep,
): CommunityMessengerWizardStep | null {
  if (!current || current === "name") return "qty";
  if (current === "qty") return "delivery";
  if (current === "delivery") {
    return fields.delivery === true ? "address" : "phone";
  }
  if (current === "address") return "phone";
  if (current === "phone") return "confirm";
  return null;
}

function promptForStep(step: CommunityMessengerWizardStep): string {
  switch (step) {
  case "name":
    return "Let's take your order step by step.\n\nWhat's your name?";
  case "qty":
    return "How many gallons do you need? (e.g. 5)";
  case "delivery":
    return "Delivery or pickup?";
  case "address":
    return "Please send your full delivery address (street/landmark, barangay, city). You may also share a location pin.";
  case "phone":
    return "What's your mobile number?";
  case "confirm":
    return "Please confirm your order below.";
  default:
    return "Please continue your order.";
  }
}

async function sendDeliveryChoice(contact: CommunityChannelContact): Promise<void> {
  const result = await sendCommunityChannelButtons({
    contact,
    text: promptForStep("delivery"),
    buttons: [
      { title: "Delivery", payload: META_POSTBACK_WIZARD_DELIVERY_YES },
      { title: "Pickup", payload: META_POSTBACK_WIZARD_DELIVERY_NO },
    ],
  });
  if (!result.ok) {
    await sendWizardMessage(
      contact,
      `${promptForStep("delivery")}\n\nReply "delivery" or "pickup".`,
      "delivery_fallback",
    );
  }
}

export async function sendCommunityOrderConfirmPrompt(
  contact: CommunityChannelContact,
  fields: CommunityOrderFields,
): Promise<void> {
  const summary = buildCommunityOrderConfirmSummary(fields);
  const result = await sendCommunityChannelButtons({
    contact,
    text: summary,
    buttons: [
      { title: "Confirm order", payload: META_POSTBACK_ORDER_CONFIRM_YES },
      { title: "Edit details", payload: META_POSTBACK_ORDER_CONFIRM_NO },
    ],
  });
  if (!result.ok) {
    await sendWizardMessage(
      contact,
      `${summary}\n\nReply "yes" to confirm or "no" to edit.`,
      "confirm_fallback",
    );
  }
}

/** CP-28 — greeting then service choice (new vs returning PSID). */
export async function replyCommunityWelcomeWithChoice(
  contact: CommunityChannelContact,
): Promise<void> {
  const isReturningUser = await hasCommunityMessengerContact(contact);
  await clearCommunityMessengerServiceMode(contact);
  await sendWizardMessage(
    contact,
    buildCommunityWelcomeMessage({ isReturningUser }),
    "welcome",
  );
  await markCommunityMessengerContactGreeted(contact);
  await sendCommunityServiceChoice(contact);
}

export async function sendCommunityServiceChoice(
  contact: CommunityChannelContact,
): Promise<void> {
  const activeOrder = await findActiveCommunityOrderForContact(contact);

  if (activeOrder) {
    const ref = activeOrder.trackReferenceId ?? activeOrder.referenceId;
    const inDelivery = activeOrder.phase === "in_delivery";

    if (inDelivery) {
      await sendWizardMessage(
        contact,
        [
          "May active order ka pa — in progress ang delivery mo.",
          "",
          `Reference: ${ref}`,
          "",
          COMMUNITY_DELIVERY_CHAT_HINT,
        ].join("\n"),
        "service_choice_active_order",
      );
      return;
    }

    const result = await sendCommunityChannelButtons({
      contact,
      text: [
        "May active order ka pa — hinihintay pa ang station.",
        "",
        `Reference: ${ref}`,
        "",
        "Kung kailangan i-cancel: CANCEL - {reason}",
        "",
        "May tanong habang naghihintay? Pili Inquiry / Others.",
      ].join("\n"),
      buttons: [{ title: "Inquiry / Others", payload: META_POSTBACK_SERVICE_INQUIRY }],
    });
    if (!result.ok) {
      await sendWizardMessage(
        contact,
        "May active order ka pa. Reply \"inquiry\" kung may tanong habang naghihintay.",
        "service_choice_active_order",
      );
    }
    return;
  }

  const result = await sendCommunityChannelButtons({
    contact,
    text: buildCommunityServiceChoicePrompt(),
    buttons: [
      { title: "Water Delivery", payload: META_POSTBACK_SERVICE_WATER_DELIVERY },
      { title: "Inquiry / Others", payload: META_POSTBACK_SERVICE_INQUIRY },
    ],
  });
  if (!result.ok) {
    await sendWizardMessage(
      contact,
      `${buildCommunityServiceChoiceReminder()}\n\nReply "delivery" for water orders or "inquiry" for other questions.`,
      "service_choice_fallback",
    );
  }
}

/**
 * After 24h idle, restart with greeting + service choice and clear wizard/service state.
 * Returns true when the session was restarted (caller should stop handling this event).
 */
export async function maybeRestartCommunitySessionAfterInactivity(
  contact: CommunityChannelContact,
): Promise<boolean> {
  if (!(await isCommunityMessengerSessionExpired(contact))) {
    return false;
  }

  const key = sessionKey(contact);
  const session = await getCommunityMessengerSession(key);
  if (sessionHasOrderProgress(session)) {
    await saveCommunityPendingOrderIntent(contact, sessionToPendingIntent(session!));
  }
  await clearCommunityMessengerSession(key);
  await replyCommunityWelcomeWithChoice(contact);
  if (sessionHasOrderProgress(session)) {
    await sendWizardMessage(
      contact,
      buildCommunityPendingOrderResumeHint(),
      "pending_order_resume",
    );
  }
  await touchCommunityMessengerInboundActivity(contact);
  return true;
}

/** Water delivery path — intro, blank form, then example + tips (or resume pending order). */
export async function replyCommunityWaterDeliveryOrderChoice(
  contact: CommunityChannelContact,
): Promise<void> {
  const pending = await loadCommunityPendingOrderIntent(contact);
  if (pending) {
    await clearCommunityPendingOrderIntent(contact);
    await sendWizardMessage(
      contact,
      "Ituloy natin ang order mo from last time. 👋",
      "pending_order_resume",
    );
    await restorePendingOrderSession(contact, pending);
    return;
  }

  await sendWizardMessage(
    contact,
    buildCommunityWaterDeliveryIntroMessage(),
    "water_delivery_intro",
  );
  await sendWizardMessage(
    contact,
    buildCommunityOrderFormMessage(),
    "water_delivery_form",
  );
  await sendWizardMessage(
    contact,
    buildCommunityOrderFormExampleMessage(),
    "water_delivery_example",
  );
}

export async function activateCommunityInquiryMode(
  contact: CommunityChannelContact,
): Promise<void> {
  const key = sessionKey(contact);
  await clearCommunityMessengerSession(key);
  await setCommunityMessengerServiceMode(contact, "inquiry");
  await ensureCommunityInquiryThreadOpen(contact);
  await sendWizardMessage(
    contact,
    buildCommunityInquiryHandoffMessage(),
    "inquiry_handoff",
  );
}

export async function activateCommunityWaterDeliveryMode(
  contact: CommunityChannelContact,
): Promise<void> {
  const pending = await loadCommunityPendingOrderIntent(contact);
  if (!pending) {
    const blocked = await blockIfActiveCommunityOrder({ contact });
    if (blocked) return;
  }

  const key = sessionKey(contact);
  await clearCommunityMessengerSession(key);
  await setCommunityMessengerServiceMode(contact, "water_delivery");
  await replyCommunityWaterDeliveryOrderChoice(contact);
}

/** Prompt service buttons when customer has not chosen a path yet. */
export async function promptCommunityServiceChoiceIfNeeded(
  contact: CommunityChannelContact,
): Promise<boolean> {
  const mode = await getCommunityMessengerServiceMode(contact);
  if (mode) return false;
  await sendCommunityServiceChoice(contact);
  return true;
}

/** Inquiry mode — store message only; no bot reply. */
export async function handleCommunityInquiryInboundText(params: {
  contact: CommunityChannelContact;
  text: string;
  metaMessageId?: string;
}): Promise<void> {
  await recordCommunityInquiryInboundMessage({
    contact: params.contact,
    text: params.text,
    metaMessageId: params.metaMessageId,
  });
  await touchCommunityMessengerInboundActivity(params.contact);
}

export async function startCommunityOrderWizard(contact: CommunityChannelContact): Promise<void> {
  if (await blockIfActiveCommunityOrder({ contact })) {
    return;
  }

  const key = sessionKey(contact);
  await clearCommunityMessengerSession(key);
  await saveCommunityMessengerSession({
    psid: key,
    sourceChannel: contact.sourceChannel,
    fields: {},
    rawMessage: "[wizard]",
    flow: "wizard",
    wizardStep: "name",
  });
  await sendWizardMessage(contact, promptForStep("name"), "wizard_start");
}

async function advanceWizardSession(params: {
  contact: CommunityChannelContact;
  session: CommunityMessengerSession;
  fields: CommunityOrderFields;
  rawMessage: string;
  nextStep: CommunityMessengerWizardStep;
}): Promise<void> {
  const key = sessionKey(params.contact);
  if (params.nextStep === "confirm") {
    await saveCommunityMessengerSession({
      psid: key,
      sourceChannel: params.contact.sourceChannel,
      fields: params.fields,
      rawMessage: params.rawMessage,
      flow: params.session.flow ?? "wizard",
      wizardStep: "confirm",
      awaitingConfirmation: "order",
    });
    await sendCommunityOrderConfirmPrompt(params.contact, params.fields);
    return;
  }

  await saveCommunityMessengerSession({
    psid: key,
    sourceChannel: params.contact.sourceChannel,
    fields: params.fields,
    rawMessage: params.rawMessage,
    flow: params.session.flow ?? "wizard",
    wizardStep: params.nextStep,
  });

  if (params.nextStep === "delivery") {
    await sendDeliveryChoice(params.contact);
    return;
  }

  await sendWizardMessage(
    params.contact,
    promptForStep(params.nextStep),
    `wizard_${params.nextStep}`,
  );
}

export type ConfirmCommunityOrderParams = {
  contact: CommunityChannelContact;
  fields: CommunityOrderFields;
  rawMessage: string;
  metaMessageId?: string;
  parseSource: "template" | "ai";
  logContext: string;
};

export type ConfirmCommunityOrderHandler = (
  params: ConfirmCommunityOrderParams,
) => Promise<void>;

let confirmOrderHandler: ConfirmCommunityOrderHandler | null = null;

export function registerCommunityOrderConfirmHandler(
  handler: ConfirmCommunityOrderHandler,
): void {
  confirmOrderHandler = handler;
}

async function confirmOrderFromSession(
  contact: CommunityChannelContact,
  session: CommunityMessengerSession,
  metaMessageId?: string,
): Promise<boolean> {
  if (!confirmOrderHandler) return false;

  const errors = validateCommunityOrderFields(session.fields);
  if (errors.length > 0) {
    await sendWizardMessage(
      contact,
      "Some details are still missing. Let's start your order again.",
      "confirm_incomplete",
    );
    await startCommunityOrderWizard(contact);
    return true;
  }

  await confirmOrderHandler({
    contact,
    fields: session.fields,
    rawMessage: session.rawMessage,
    metaMessageId,
    parseSource: session.flow === "ai" ? "ai" : "template",
    logContext: session.flow === "ai" ? "ai_confirmed" : "wizard_confirmed",
  });
  return true;
}

export async function handleCommunityMessengerPostback(params: {
  contact: CommunityChannelContact;
  payload: string;
  metaMessageId?: string;
}): Promise<boolean> {
  const { contact, payload, metaMessageId } = params;
  const key = sessionKey(contact);

  if (await maybeRestartCommunitySessionAfterInactivity(contact)) {
    return true;
  }

  if (payload === META_POSTBACK_DELIVERY_CHAT) {
    await openDeliveryChatFromCustomerAction({ contact, metaMessageId });
    return true;
  }

  if (payload === META_POSTBACK_SERVICE_WATER_DELIVERY) {
    await activateCommunityWaterDeliveryMode(contact);
    return true;
  }

  if (payload === META_POSTBACK_SERVICE_INQUIRY) {
    await activateCommunityInquiryMode(contact);
    return true;
  }

  const serviceMode = await getCommunityMessengerServiceMode(contact);
  if (serviceMode === "inquiry") {
    return true;
  }

  if (serviceMode !== "water_delivery") {
    await sendCommunityServiceChoice(contact);
    return true;
  }

  if (payload === META_POSTBACK_WIZARD_START) {
    await startCommunityOrderWizard(contact);
    return true;
  }

  if (payload === META_POSTBACK_ORDER_FORM) {
    const session = await getCommunityMessengerSession(key);
    if (await blockIfActiveCommunityOrder({ contact, session })) {
      return true;
    }
    await clearCommunityMessengerSession(key);
    await sendWizardMessage(contact, buildCommunityOrderFormMessage(), "order_form");
    await sendWizardMessage(contact, buildCommunityOrderFormExampleMessage(), "order_form_example");
    return true;
  }

  const session = await getCommunityMessengerSession(key);

  if (
    payload === META_POSTBACK_ORDER_CONFIRM_YES ||
    payload === META_POSTBACK_WIZARD_DELIVERY_YES ||
    payload === META_POSTBACK_WIZARD_DELIVERY_NO
  ) {
    if (payload === META_POSTBACK_ORDER_CONFIRM_YES) {
      if (!session) return false;
      return confirmOrderFromSession(contact, session, metaMessageId);
    }

    if (!session || session.wizardStep !== "delivery") return false;

    const delivery = payload === META_POSTBACK_WIZARD_DELIVERY_YES;
    const fields = mergeDefinedFields(session.fields, { delivery });
    const nextStep = delivery ? "address" : "phone";
    await advanceWizardSession({
      contact,
      session,
      fields,
      rawMessage: `${session.rawMessage}\n---\n[delivery: ${delivery ? "yes" : "no"}]`,
      nextStep,
    });
    return true;
  }

  if (payload === META_POSTBACK_ORDER_CONFIRM_NO) {
    await clearCommunityMessengerSession(key);
    await sendWizardMessage(
      contact,
      buildCommunityOrderEditPromptMessage(),
      "confirm_declined",
    );
    return true;
  }

  return false;
}

export async function handleCommunityWizardText(params: {
  contact: CommunityChannelContact;
  text: string;
  metaMessageId?: string;
  session: CommunityMessengerSession;
}): Promise<boolean> {
  const { contact, text, session } = params;
  if (!session.wizardStep || session.wizardStep === "confirm") return false;

  const step = session.wizardStep;
  let patch: CommunityOrderFields = {};
  let invalidMessage: string | null = null;

  if (step === "name") {
    const name = text.trim().slice(0, 120);
    if (name.length < 2) {
      invalidMessage = "Please send your name (at least 2 characters).";
    } else {
      patch = { name };
    }
  } else if (step === "qty") {
    const qty = parseWizardQty(text);
    if (!qty) {
      invalidMessage = "Please send a number of gallons (e.g. 5).";
    } else {
      patch = { qty };
    }
  } else if (step === "address") {
    const location = text.trim().slice(0, 240);
    if (location.length < 5) {
      invalidMessage = "Please send a fuller address or share a location pin.";
    } else {
      patch = { location };
    }
  } else if (step === "phone") {
    const number = parseWizardPhone(text);
    if (!number) {
      invalidMessage = "Please send a valid mobile number (10–13 digits).";
    } else {
      patch = { number };
    }
  } else if (step === "delivery") {
    return false;
  }

  if (invalidMessage) {
    await sendWizardMessage(contact, invalidMessage, `wizard_invalid_${step}`);
    return true;
  }

  const fields = mergeDefinedFields(session.fields, patch);
  const nextStep = nextWizardStep(fields, step);
  if (!nextStep) return false;

  await advanceWizardSession({
    contact,
    session,
    fields,
    rawMessage: `${session.rawMessage}\n---\n${text}`,
    nextStep,
  });
  return true;
}

export function wizardSessionLooksLikeTemplate(text: string): boolean {
  return parseCommunityOrderTemplate(text).looksLikeTemplate;
}
