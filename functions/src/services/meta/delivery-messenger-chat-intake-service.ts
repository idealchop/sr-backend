import { logger } from "../observability/logging/logger";
import type { CommunityChannelContact } from "./community-channel-contact";
import { sendCommunityChannelText } from "./community-channel-outbound-service";
import {
  findAcceptedDeliveryChatContext,
} from "./community-active-order-guard-service";
import {
  closeCustomerDeliveryChat,
  isCustomerDeliveryChatModeOpen,
  openCustomerDeliveryChat,
  parseDeliveryChatCommand,
  recordCustomerDeliveryChatMessage,
} from "./delivery-messenger-chat-service";
import { buildCommunityDeliveryChatUnavailableMessage } from "./community-messenger-copy";

export async function openDeliveryChatFromCustomerAction(params: {
  contact: CommunityChannelContact;
  metaMessageId?: string;
}): Promise<boolean> {
  const context = await findAcceptedDeliveryChatContext(params.contact);
  if (!context) {
    await sendCommunityChannelText(
      params.contact,
      buildCommunityDeliveryChatUnavailableMessage(),
    );
    return true;
  }
  await openCustomerDeliveryChat({ contact: params.contact, context });
  logger.info("delivery_chat_customer_open", {
    contactId: params.contact.contactId,
    businessId: context.businessId,
    referenceId: context.trackReferenceId ?? context.referenceId,
  });
  return true;
}

/**
 * Customer delivery chat — CHAT / CLOSE CHAT and passthrough while chat mode is open.
 * Returns true when the message was handled (caller should stop intake).
 */
export async function tryHandleCustomerDeliveryChatInbound(params: {
  contact: CommunityChannelContact;
  text: string;
  metaMessageId?: string;
}): Promise<boolean> {
  const command = parseDeliveryChatCommand(params.text);
  const chatOpen = await isCustomerDeliveryChatModeOpen(params.contact);

  if (command.kind === "none" && !chatOpen) {
    return false;
  }

  const context = await findAcceptedDeliveryChatContext(params.contact);

  if (command.kind === "open") {
    return openDeliveryChatFromCustomerAction({
      contact: params.contact,
      metaMessageId: params.metaMessageId,
    });
  }

  if (command.kind === "close") {
    const closed = await closeCustomerDeliveryChat(params.contact);
    if (!closed && !context) {
      await sendCommunityChannelText(
        params.contact,
        "Walang open na delivery chat.",
      );
    }
    return true;
  }

  if (chatOpen && context) {
    await recordCustomerDeliveryChatMessage({
      contact: params.contact,
      text: params.text,
      metaMessageId: params.metaMessageId,
      context,
    });
    return true;
  }

  if (chatOpen && !context) {
    await closeCustomerDeliveryChat(params.contact);
    await sendCommunityChannelText(
      params.contact,
      "Natapos na ang delivery — sarado na ang chat.",
    );
    return true;
  }

  return false;
}
