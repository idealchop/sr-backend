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
  META_POSTBACK_GET_STARTED,
  META_POSTBACK_ORDER_START,
} from "./community-order-template";
import { buildCommunityChannelContact } from "./community-channel-contact";
import { parseMessengerLocationAttachment } from "./meta-messenger-location";
import { readMetaCommunityPageId } from "./meta-messenger-send-service";
import {
  handleRiderMessengerEvent,
  shouldRouteToRiderMessenger,
  type MetaMessagingEventLike,
} from "../rider/rider-messenger-routing";
import {
  handleTeamMessengerEvent,
  shouldRouteToTeamMessenger,
} from "../team/team-messenger-routing";

type MetaMessagingEvent = MetaMessagingEventLike & {
  recipient?: { id?: string };
  postback?: { payload?: string; title?: string };
};

type MetaWebhookBody = {
  object?: string;
  entry?: Array<{
    id?: string;
    messaging?: MetaMessagingEvent[];
  }>;
};

function readSenderPsid(event: MetaMessagingEvent): string | undefined {
  const id = event.sender?.id?.trim();
  return id || undefined;
}

function entryMatchesConfiguredPage(entryPageId: string | undefined): boolean {
  if (process.env.FUNCTIONS_EMULATOR || process.env.SMARTREFILL_ENV_DEV === "true") {
    return true;
  }
  const configured = readMetaCommunityPageId();
  if (!configured || !entryPageId) return true;
  return entryPageId === configured;
}

async function handleMessagingEvent(event: MetaMessagingEvent): Promise<void> {
  const psid = readSenderPsid(event);
  if (!psid) return;

  if (await shouldRouteToRiderMessenger(event)) {
    await handleRiderMessengerEvent(event);
    return;
  }

  if (await shouldRouteToTeamMessenger(event)) {
    await handleTeamMessengerEvent(event);
    return;
  }

  const contact = buildCommunityChannelContact({
    sourceChannel: "community_messenger",
    contactId: psid,
  });

  const postbackPayload = event.postback?.payload?.trim();
  const quickReplyPayload = event.message?.quick_reply?.payload?.trim();
  const messengerPayload = postbackPayload || quickReplyPayload;

  if (messengerPayload) {
    if (
      messengerPayload === META_POSTBACK_GET_STARTED ||
      messengerPayload === META_POSTBACK_ORDER_START
    ) {
      await replyCommunityWelcomeWithChoice(contact);
      return;
    }

    const handled = await handleCommunityMessengerPostback({
      contact,
      payload: messengerPayload,
      metaMessageId: event.message?.mid?.trim(),
    });
    if (handled) return;
  }

  if (postbackPayload) return;

  if (event.message?.is_echo === true) return;

  const locationPin = parseMessengerLocationAttachment(event.message);
  if (locationPin) {
    await handleCommunityInboundLocation({
      contact,
      latitude: locationPin.latitude,
      longitude: locationPin.longitude,
      metaMessageId: event.message?.mid?.trim(),
    });
    return;
  }

  const text = event.message?.text?.trim();
  if (text) {
    await handleCommunityInboundText({
      contact,
      text,
      metaMessageId: event.message?.mid?.trim(),
    });
  }
}

/**
 * CP-01–CP-04 + AI-04/48 — Meta community Page webhook processor.
 */
export async function processMetaCommunityWebhook(body: unknown): Promise<void> {
  const payload = body as MetaWebhookBody;
  if (payload.object !== "page" || !Array.isArray(payload.entry)) {
    logger.info("processMetaCommunityWebhook skip_non_page_event", {
      object: payload.object,
    });
    return;
  }

  for (const entry of payload.entry) {
    if (!entryMatchesConfiguredPage(entry.id?.trim())) {
      logger.warn("processMetaCommunityWebhook page_id_mismatch", {
        entryId: entry.id,
      });
      continue;
    }

    for (const event of entry.messaging ?? []) {
      await handleMessagingEvent(event);
    }
  }
}
