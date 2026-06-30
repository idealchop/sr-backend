import { logger } from "../observability/logging/logger";
import {
  handleCommunityInboundLocation,
  handleCommunityInboundText,
} from "./community-order-intake-service";
import {
  handleCommunityMessengerPostback,
  replyCommunityWelcomeWithChoice,
} from "./community-order-wizard-service";
import {
  buildCommunityChannelContact,
  type CommunitySourceChannel,
} from "./community-channel-contact";
import {
  META_POSTBACK_GET_STARTED,
  META_POSTBACK_ORDER_START,
} from "./community-order-template";

type WhatsappTextMessage = {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
  location?: { latitude?: number; longitude?: number };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
  };
};

type WhatsappWebhookBody = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string };
        messages?: WhatsappTextMessage[];
      };
    }>;
  }>;
};

function readConfiguredWhatsappPhoneNumberId(): string | null {
  const id = process.env.WHATSAPP_COMMUNITY_PHONE_NUMBER_ID?.trim();
  return id || null;
}

function entryMatchesConfiguredPhone(phoneNumberId: string | undefined): boolean {
  if (process.env.FUNCTIONS_EMULATOR || process.env.SMARTREFILL_ENV_DEV === "true") {
    return true;
  }
  const configured = readConfiguredWhatsappPhoneNumberId();
  if (!configured || !phoneNumberId) return true;
  return phoneNumberId === configured;
}

async function handleWhatsappMessage(params: {
  waId: string;
  message: WhatsappTextMessage;
}): Promise<void> {
  const contact = buildCommunityChannelContact({
    sourceChannel: "community_whatsapp",
    contactId: params.waId,
  });
  const messageId = params.message.id?.trim();

  const interactiveId = params.message.interactive?.button_reply?.id?.trim();
  if (interactiveId) {
    const isStartPayload =
      interactiveId === META_POSTBACK_GET_STARTED ||
      interactiveId === META_POSTBACK_ORDER_START;
    if (isStartPayload) {
      await replyCommunityWelcomeWithChoice(contact);
      return;
    }
    const handled = await handleCommunityMessengerPostback({
      contact,
      payload: interactiveId,
      metaMessageId: messageId,
    });
    if (handled) return;
  }

  if (params.message.type === "location") {
    const lat = Number(params.message.location?.latitude);
    const lng = Number(params.message.location?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      await handleCommunityInboundLocation({
        contact,
        latitude: lat,
        longitude: lng,
        metaMessageId: messageId,
      });
    }
    return;
  }

  const text = params.message.text?.body?.trim();
  if (text) {
    await handleCommunityInboundText({
      contact,
      text,
      metaMessageId: messageId,
    });
  }
}

/**
 * CP-30 — WhatsApp Cloud API webhook processor (same intake + dispatch as Messenger).
 */
export async function processMetaCommunityWhatsappWebhook(body: unknown): Promise<void> {
  const payload = body as WhatsappWebhookBody;
  if (payload.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) {
    logger.info("processMetaCommunityWhatsappWebhook skip_non_whatsapp_event", {
      object: payload.object,
    });
    return;
  }

  for (const entry of payload.entry) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id?.trim();
      if (!entryMatchesConfiguredPhone(phoneNumberId)) {
        logger.warn("processMetaCommunityWhatsappWebhook phone_id_mismatch", {
          phoneNumberId,
        });
        continue;
      }

      for (const message of value?.messages ?? []) {
        const waId = message.from?.trim();
        if (!waId) continue;
        await handleWhatsappMessage({ waId, message });
      }
    }
  }
}

export function resolveWhatsappSourceChannel(): CommunitySourceChannel {
  return "community_whatsapp";
}
