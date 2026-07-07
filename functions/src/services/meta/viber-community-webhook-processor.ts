import { logger } from "../observability/logging/logger";
import {
  handleCommunityInboundLocation,
  handleCommunityInboundText,
} from "./community-order-intake-service";
import {
  handleCommunityMessengerPostback,
  replyCommunityWelcomeWithChoice,
} from "./community-order-wizard-service";
import { buildCommunityChannelContact } from "./community-channel-contact";
import {
  META_POSTBACK_GET_STARTED,
  META_POSTBACK_ORDER_START,
} from "./community-order-template";

type ViberSender = {
  id?: string;
  name?: string;
};

type ViberMessage = {
  type?: string;
  text?: string;
  location?: { lat?: number; lon?: number };
};

export type ViberWebhookBody = {
  event?: string;
  timestamp?: number;
  message_token?: number;
  sender?: ViberSender;
  message?: ViberMessage;
  user?: ViberSender;
};

function readViberUserId(body: ViberWebhookBody): string | null {
  const id = body.sender?.id?.trim() || body.user?.id?.trim();
  return id || null;
}

async function handleViberTextMessage(params: {
  viberUserId: string;
  text: string;
  messageToken?: number;
}): Promise<void> {
  const contact = buildCommunityChannelContact({
    sourceChannel: "community_viber",
    contactId: params.viberUserId,
  });
  const messageId = params.messageToken ? String(params.messageToken) : undefined;
  const text = params.text.trim();
  if (!text) return;

  const isStartPayload =
    text === META_POSTBACK_GET_STARTED || text === META_POSTBACK_ORDER_START;
  if (isStartPayload) {
    await replyCommunityWelcomeWithChoice(contact);
    return;
  }

  const handled = await handleCommunityMessengerPostback({
    contact,
    payload: text,
    metaMessageId: messageId,
  });
  if (handled) return;

  await handleCommunityInboundText({
    contact,
    text,
    metaMessageId: messageId,
  });
}

async function handleViberLocationMessage(params: {
  viberUserId: string;
  latitude: number;
  longitude: number;
  messageToken?: number;
}): Promise<void> {
  const contact = buildCommunityChannelContact({
    sourceChannel: "community_viber",
    contactId: params.viberUserId,
  });

  await handleCommunityInboundLocation({
    contact,
    latitude: params.latitude,
    longitude: params.longitude,
    metaMessageId: params.messageToken ? String(params.messageToken) : undefined,
  });
}

/**
 * CP-31 — Viber Public Account webhook processor (same intake + dispatch as Messenger).
 */
export async function processViberCommunityWebhook(body: unknown): Promise<void> {
  const payload = body as ViberWebhookBody;
  const event = payload.event?.trim();
  if (!event) {
    logger.info("processViberCommunityWebhook skip_missing_event");
    return;
  }

  const viberUserId = readViberUserId(payload);
  if (!viberUserId) {
    if (event !== "webhook") {
      logger.info("processViberCommunityWebhook skip_missing_user", { event });
    }
    return;
  }

  const contact = buildCommunityChannelContact({
    sourceChannel: "community_viber",
    contactId: viberUserId,
  });
  const messageToken = payload.message_token;

  if (event === "conversation_started" || event === "subscribed") {
    await replyCommunityWelcomeWithChoice(contact);
    return;
  }

  if (event !== "message" || !payload.message) {
    return;
  }

  const message = payload.message;

  if (message.type === "location") {
    const lat = Number(message.location?.lat);
    const lon = Number(message.location?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      await handleViberLocationMessage({
        viberUserId,
        latitude: lat,
        longitude: lon,
        messageToken,
      });
    }
    return;
  }

  if (message.type === "text" && message.text?.trim()) {
    await handleViberTextMessage({
      viberUserId,
      text: message.text,
      messageToken,
    });
  }
}
