import { logger } from "../observability/logging/logger";
import type { CommunityChannelContact } from "./community-channel-contact";
import { sendCommunityChannelButtons, sendCommunityChannelText } from "./community-channel-outbound-service";
import type { CommunityOrderFields } from "./community-dispatch-template-parser";
import {
  parseCommunityOrderTemplate,
  validateCommunityOrderFields,
} from "./community-dispatch-template-parser";
import {
  buildCommunityOrderFormMessage,
  buildCommunityWelcomeMessage,
  META_POSTBACK_ORDER_CONFIRM_NO,
  META_POSTBACK_ORDER_CONFIRM_YES,
  META_POSTBACK_ORDER_FORM,
  META_POSTBACK_WIZARD_DELIVERY_NO,
  META_POSTBACK_WIZARD_DELIVERY_YES,
  META_POSTBACK_WIZARD_START,
} from "./community-order-template";
import { buildCommunityOrderConfirmSummary } from "./community-order-reply-service";
import {
  clearCommunityMessengerSession,
  getCommunityMessengerSession,
  mergeDefinedFields,
  saveCommunityMessengerSession,
  type CommunityMessengerSession,
  type CommunityMessengerWizardStep,
} from "./community-messenger-session-service";

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

/** CP-28 — welcome with step-by-step vs order form choice. */
export async function replyCommunityWelcomeWithChoice(
  contact: CommunityChannelContact,
): Promise<void> {
  await sendWizardMessage(contact, buildCommunityWelcomeMessage(), "welcome");
  const result = await sendCommunityChannelButtons({
    contact,
    text: "How would you like to order?",
    buttons: [
      { title: "Step-by-step", payload: META_POSTBACK_WIZARD_START },
      { title: "Order form", payload: META_POSTBACK_ORDER_FORM },
    ],
  });
  if (!result.ok) {
    await sendWizardMessage(
      contact,
      `Reply "wizard" for step-by-step, or copy this form:\n\n${buildCommunityOrderFormMessage()}`,
      "welcome_choice_fallback",
    );
  }
}

export async function startCommunityOrderWizard(contact: CommunityChannelContact): Promise<void> {
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

  if (payload === META_POSTBACK_WIZARD_START) {
    await startCommunityOrderWizard(contact);
    return true;
  }

  if (payload === META_POSTBACK_ORDER_FORM) {
    await clearCommunityMessengerSession(key);
    await sendWizardMessage(contact, buildCommunityOrderFormMessage(), "order_form");
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
      "No problem — you can send a new message with your order details, or tap Step-by-step to try again.",
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
