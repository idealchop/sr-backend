import { logger } from "../observability/logging/logger";
import {
  parseCommunityOrderTemplate,
  validateCommunityOrderFields,
  type CommunityOrderFields,
} from "./community-dispatch-template-parser";
import {
  appendCommunityDispatchRequestFollowUp,
  buildFallbackMetaMessageId,
  persistValidatedCommunityOrder,
} from "./community-dispatch-request-service";
import type {
  CommunityDispatchGeocode,
  CommunityDispatchParseSource,
} from "./community-dispatch-request-types";
import { routeCommunityDispatchRequest } from "./community-dispatch-route-service";
import type { CommunityRouteResult } from "./community-dispatch-route-service";
import {
  buildRetryFieldsFromFollowUp,
  findPendingCommunityDispatchRequest,
  mergeCommunityOrderFields,
} from "./community-dispatch-retry-service";
import { incrementCommunityChannelIntake } from "./community-platform-channel-usage-service";
import { GeocodingService } from "../maps/geocoding-service";
import { parseCommunityFreeTextOrder } from "./community-order-nlu-service";
import {
  buildCommunityClarificationMessage,
  buildCommunityFreeTextClarificationMessage,
  buildCommunityTemplateRepairReply,
  buildLocationPinReceivedMessage,
} from "./community-order-reply-service";
import {
  handleCommunityWizardText,
  registerCommunityOrderConfirmHandler,
  replyCommunityWelcomeWithChoice,
  sendCommunityOrderConfirmPrompt,
  wizardSessionLooksLikeTemplate,
} from "./community-order-wizard-service";
import { tryCancelActiveCommunityRequest } from "./community-dispatch-cancel-service";
import {
  applySessionFollowUp,
  clearCommunityMessengerSession,
  getCommunityMessengerSession,
  isOrderConfirmationAffirmation,
  isOrderConfirmationDenial,
  isShortAffirmation,
  isShortDenial,
  mergeDefinedFields,
  saveCommunityMessengerSession,
} from "./community-messenger-session-service";
import {
  buildCommunityChannelContact,
  type CommunityChannelContact,
} from "./community-channel-contact";
import { sendCommunityChannelText } from "./community-channel-outbound-service";
import {
  isCasualMessengerGreeting,
} from "./community-order-template";
import {
  buildMessengerPinLocationLabel,
} from "./meta-messenger-location";

type InboundTextParams = {
  contact: CommunityChannelContact;
  text: string;
  metaMessageId?: string;
};

type LocationPinContext = {
  locationText: string;
  geocode: CommunityDispatchGeocode;
};

function sessionKey(contact: CommunityChannelContact): string {
  return contact.contactId;
}

async function sendReply(
  contact: CommunityChannelContact,
  message: string,
  context: string,
): Promise<void> {
  const result = await sendCommunityChannelText(contact, message);
  if (!result.ok) {
    logger.warn("communityOrderIntake send_failed", {
      contactId: contact.contactId,
      channel: contact.sourceChannel,
      context,
      reason: result.reason,
    });
  }
}

async function deliverRouteReply(
  contact: CommunityChannelContact,
  routed: CommunityRouteResult,
  context: string,
): Promise<void> {
  await sendReply(contact, routed.replyMessage, context);
}

/** CP-02 postbacks — greeting then step-by-step vs order form choice. */
export async function replyCommunityWelcomeWithForm(psid: string): Promise<void> {
  await replyCommunityWelcomeWithChoice(
    buildCommunityChannelContact({ sourceChannel: "community_messenger", contactId: psid }),
  );
}

/** CP-02 — Order menu / new order: same flow as Get Started. */
export async function replyCommunityTemplatePrompt(psid: string): Promise<void> {
  await replyCommunityWelcomeWithForm(psid);
}

/** CP-02 welcome for casual greetings — choice flow. */
export async function replyCommunityWelcome(contact: CommunityChannelContact): Promise<void> {
  await replyCommunityWelcomeWithChoice(contact);
}

registerCommunityOrderConfirmHandler(async (params) => {
  await confirmPersistedOrder(params);
});

async function confirmPersistedOrder(params: {
  contact: CommunityChannelContact;
  rawMessage: string;
  metaMessageId?: string;
  fields: CommunityOrderFields;
  parseSource: CommunityDispatchParseSource;
  logContext: string;
  geocodeHint?: CommunityDispatchGeocode;
}): Promise<void> {
  const messageId =
    params.metaMessageId?.trim() ||
    buildFallbackMetaMessageId(params.contact.contactId, params.rawMessage);

  const persisted = await persistValidatedCommunityOrder({
    contact: params.contact,
    metaMessageId: messageId,
    rawMessage: params.rawMessage,
    fields: params.fields,
    parseSource: params.parseSource,
  });

  if (!persisted.created) {
    logger.info("communityOrderIntake duplicate_message_skipped", {
      contactId: params.contact.contactId,
      channel: params.contact.sourceChannel,
      metaMessageId: messageId,
      requestId: persisted.id,
    });
    return;
  }

  await clearCommunityMessengerSession(sessionKey(params.contact));
  await incrementCommunityChannelIntake(params.contact.sourceChannel);

  try {
    const routed = await routeCommunityDispatchRequest({
      requestId: persisted.id,
      fields: params.fields,
      geocodeHint: params.geocodeHint,
    });
    await deliverRouteReply(params.contact, routed, params.logContext);
  } catch (error) {
    logger.error("communityOrderIntake routing_failed", error);
    await sendReply(
      params.contact,
      "Thank you — we received your order and our team is reviewing it. Salamat po!",
      "routing_failed_fallback",
    );
  }
}

async function tryRetryPendingDispatchRequest(params: {
  contact: CommunityChannelContact;
  followUpMessage: string;
  templateParse: ReturnType<typeof parseCommunityOrderTemplate>;
  locationPin?: LocationPinContext;
}): Promise<boolean> {
  const pending = await findPendingCommunityDispatchRequest(params.contact.contactId);
  if (!pending) return false;

  const mergedFields =
    params.locationPin && pending.doc.status === "needs_location" ?
      mergeCommunityOrderFields(pending.doc.parsed ?? {}, {
        location: params.locationPin.locationText,
        delivery: pending.doc.parsed?.delivery ?? true,
      }) :
      buildRetryFieldsFromFollowUp({
        pending,
        text: params.followUpMessage,
        templateFields: params.templateParse.fields,
        templateLooksComplete:
          params.templateParse.looksLikeTemplate && params.templateParse.ok,
      });

  if (!mergedFields) return false;

  await appendCommunityDispatchRequestFollowUp({
    requestId: pending.id,
    fields: mergedFields,
    followUpMessage: params.followUpMessage,
  });

  await clearCommunityMessengerSession(sessionKey(params.contact));

  try {
    const routed = await routeCommunityDispatchRequest({
      requestId: pending.id,
      fields: mergedFields,
      geocodeHint: params.locationPin?.geocode,
    });
    logger.info("communityOrderIntake dispatch_retry", {
      contactId: params.contact.contactId,
      requestId: pending.id,
      priorStatus: pending.doc.status,
      nextStatus: routed.status,
      source: params.locationPin ? "location_pin" : "text",
    });
    await deliverRouteReply(params.contact, routed, "dispatch_retry");
  } catch (error) {
    logger.error("communityOrderIntake dispatch_retry_failed", error);
    await sendReply(
      params.contact,
      "Salamat po — we received your update and our team is reviewing it.",
      "dispatch_retry_failed",
    );
  }

  return true;
}

async function resolveMessengerLocationPin(
  latitude: number,
  longitude: number,
): Promise<LocationPinContext> {
  const reversed = await GeocodingService.reverseGeocodeCoordinates(
    latitude,
    longitude,
  );
  const geocode: CommunityDispatchGeocode = reversed ?
    {
      latitude: reversed.latitude,
      longitude: reversed.longitude,
      formattedAddress: reversed.formattedAddress,
    } :
    {
      latitude,
      longitude,
      formattedAddress: buildMessengerPinLocationLabel(latitude, longitude),
    };

  return {
    locationText: geocode.formattedAddress ?? buildMessengerPinLocationLabel(latitude, longitude),
    geocode,
  };
}

/** Messenger location attachment — pin or current location from the customer. */
export async function handleCommunityInboundLocation(params: {
  contact: CommunityChannelContact;
  latitude: number;
  longitude: number;
  metaMessageId?: string;
}): Promise<void> {
  const key = sessionKey(params.contact);
  const locationPin = await resolveMessengerLocationPin(
    params.latitude,
    params.longitude,
  );
  const followUpMessage = `[location pin] ${locationPin.locationText}`;
  const emptyTemplate = parseCommunityOrderTemplate("");

  if (
    await tryRetryPendingDispatchRequest({
      contact: params.contact,
      followUpMessage,
      templateParse: emptyTemplate,
      locationPin,
    })
  ) {
    return;
  }

  const existingSession = await getCommunityMessengerSession(key);
  if (existingSession?.wizardStep === "address") {
    const fields = mergeDefinedFields(existingSession.fields, {
      location: locationPin.locationText,
    });
    await saveCommunityMessengerSession({
      psid: key,
      sourceChannel: params.contact.sourceChannel,
      fields,
      rawMessage: `${existingSession.rawMessage}\n---\n${followUpMessage}`,
      flow: "wizard",
      wizardStep: "phone",
    });
    await sendReply(
      params.contact,
      "Salamat po — location received. What's your mobile number?",
      "wizard_phone",
    );
    return;
  }

  const mergedFields = mergeDefinedFields(
    existingSession?.fields ?? {},
    {
      delivery: existingSession?.fields.delivery ?? true,
      location: locationPin.locationText,
    },
  );

  const validationErrors = validateCommunityOrderFields(mergedFields);
  if (validationErrors.length === 0) {
    await confirmPersistedOrder({
      contact: params.contact,
      rawMessage: existingSession ?
        `${existingSession.rawMessage}\n---\n${followUpMessage}` :
        followUpMessage,
      metaMessageId: params.metaMessageId,
      fields: mergedFields,
      parseSource: "template",
      logContext: "location_pin_confirmed",
      geocodeHint: locationPin.geocode,
    });
    return;
  }

  await saveCommunityMessengerSession({
    psid: key,
    sourceChannel: params.contact.sourceChannel,
    fields: mergedFields,
    rawMessage: existingSession ?
      `${existingSession.rawMessage}\n---\n${followUpMessage}` :
      followUpMessage,
  });

  logger.info("communityOrderIntake location_pin_partial", {
    contactId: params.contact.contactId,
    errors: validationErrors,
  });
  await sendReply(
    params.contact,
    buildLocationPinReceivedMessage(validationErrors),
    "location_pin_partial",
  );
}

/**
 * CP-03 / CP-04 / CP-05 / CP-06+ — parse, persist, route, and reply.
 */
export async function handleCommunityInboundText(params: InboundTextParams): Promise<void> {
  const { contact, text, metaMessageId } = params;
  const key = sessionKey(contact);
  const trimmed = text.trim();
  if (!trimmed) return;

  if (await tryCancelActiveCommunityRequest({ contact, text: trimmed })) {
    return;
  }

  if (isCasualMessengerGreeting(trimmed)) {
    await replyCommunityWelcome(contact);
    return;
  }

  const templateParse = parseCommunityOrderTemplate(trimmed);

  if (await tryRetryPendingDispatchRequest({ contact, followUpMessage: trimmed, templateParse })) {
    return;
  }

  const existingSession = await getCommunityMessengerSession(key);

  if (existingSession?.awaitingConfirmation === "order") {
    if (isOrderConfirmationAffirmation(existingSession, trimmed)) {
      await confirmPersistedOrder({
        contact,
        rawMessage: `${existingSession.rawMessage}\n---\n${trimmed}`,
        metaMessageId,
        fields: existingSession.fields,
        parseSource: existingSession.flow === "ai" ? "ai" : "template",
        logContext: existingSession.flow === "ai" ? "ai_confirmed" : "wizard_confirmed",
      });
      return;
    }
    if (isOrderConfirmationDenial(existingSession, trimmed)) {
      await clearCommunityMessengerSession(key);
      await sendReply(
        contact,
        "No problem — send your order again when ready.",
        "confirm_declined",
      );
      return;
    }
  }

  if (
    existingSession &&
    existingSession.awaitingConfirmation === "delivery" &&
    (isShortAffirmation(trimmed) || isShortDenial(trimmed))
  ) {
    const mergedFields = applySessionFollowUp(existingSession, trimmed);
    const sessionErrors = validateCommunityOrderFields(mergedFields);
    if (sessionErrors.length === 0) {
      await confirmPersistedOrder({
        contact,
        rawMessage: `${existingSession.rawMessage}\n---\n${trimmed}`,
        metaMessageId,
        fields: mergedFields,
        parseSource: "ai",
        logContext: "session_confirmed",
      });
      return;
    }
  }

  if (existingSession?.wizardStep && existingSession.wizardStep !== "confirm") {
    if (!wizardSessionLooksLikeTemplate(trimmed)) {
      const handled = await handleCommunityWizardText({
        contact,
        text: trimmed,
        metaMessageId,
        session: existingSession,
      });
      if (handled) return;
    } else {
      await clearCommunityMessengerSession(key);
    }
  }

  logger.info("communityOrderIntake template_parse", {
    contactId: contact.contactId,
    channel: contact.sourceChannel,
    looksLikeTemplate: templateParse.looksLikeTemplate,
    ok: templateParse.ok,
    errors: templateParse.errors,
  });

  if (templateParse.looksLikeTemplate) {
    if (!templateParse.ok) {
      const repair = await buildCommunityTemplateRepairReply({
        errors: templateParse.errors,
        partialFields: templateParse.fields,
        rawMessage: trimmed,
      });
      logger.info("communityOrderIntake template_repair", {
        contactId: contact.contactId,
        errors: templateParse.errors,
        source: repair.source,
      });
      await sendReply(contact, repair.message, "template_repair");
      return;
    }

    await confirmPersistedOrder({
      contact,
      rawMessage: trimmed,
      metaMessageId,
      fields: templateParse.fields,
      parseSource: "template",
      logContext: "template_confirmed",
    });
    return;
  }

  const nlu = await parseCommunityFreeTextOrder(trimmed);
  const mergedFields = existingSession ?
    mergeDefinedFields(existingSession.fields, nlu.fields) :
    nlu.fields;
  const validationErrors = validateCommunityOrderFields(mergedFields);

  if (validationErrors.length === 0) {
    const rawMessage = existingSession ?
      `${existingSession.rawMessage}\n---\n${trimmed}` :
      trimmed;
    await saveCommunityMessengerSession({
      psid: key,
      sourceChannel: contact.sourceChannel,
      fields: mergedFields,
      rawMessage,
      flow: "ai",
      wizardStep: "confirm",
      awaitingConfirmation: "order",
    });
    await sendCommunityOrderConfirmPrompt(contact, mergedFields);
    logger.info("communityOrderIntake free_text_confirm_prompt", {
      contactId: contact.contactId,
      confidence: nlu.confidence,
      source: nlu.source,
    });
    return;
  }

  const needsClarification =
    nlu.confidence < 0.65 ||
    validationErrors.length > 0 ||
    Boolean(nlu.clarifyingQuestion);

  if (needsClarification) {
    const clarifier =
      nlu.clarifyingQuestion && validationErrors.length === 0 ?
        buildCommunityFreeTextClarificationMessage(nlu.clarifyingQuestion) :
        validationErrors.length > 0 ?
          buildCommunityClarificationMessage(validationErrors, mergedFields) :
          buildCommunityFreeTextClarificationMessage(
            nlu.clarifyingQuestion ?? "Paki-complete po ang order details namin.",
          );

    const awaitingConfirmation =
      validationErrors.includes("delivery") ||
      (mergedFields.delivery !== undefined &&
        Boolean(nlu.clarifyingQuestion?.toLowerCase().includes("delivery"))) ?
        "delivery" :
        undefined;

    await saveCommunityMessengerSession({
      psid: key,
      sourceChannel: contact.sourceChannel,
      fields: mergedFields,
      rawMessage: existingSession ?
        `${existingSession.rawMessage}\n---\n${trimmed}` :
        trimmed,
      awaitingConfirmation,
    });

    logger.info("communityOrderIntake free_text_clarify", {
      contactId: contact.contactId,
      confidence: nlu.confidence,
      errors: validationErrors,
      source: nlu.source,
      awaitingConfirmation,
    });
    await sendReply(contact, clarifier, "free_text_clarify");
    return;
  }
}
