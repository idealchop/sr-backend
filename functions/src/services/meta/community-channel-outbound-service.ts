import type { CommunityChannelContact } from "./community-channel-contact";
import {
  sendMetaMessengerButtonTemplate,
  sendMetaMessengerText,
  type MessengerPostbackButton,
} from "./meta-messenger-send-service";
import {
  sendWhatsappCommunityButtons,
  sendWhatsappCommunityText,
} from "./meta-whatsapp-send-service";
import {
  sendViberCommunityButtons,
  sendViberCommunityText,
} from "./viber-community-send-service";

export type ChannelSendResult = { ok: true } | { ok: false; reason: string };

export async function sendCommunityChannelText(
  contact: CommunityChannelContact,
  text: string,
): Promise<ChannelSendResult> {
  if (contact.sourceChannel === "community_whatsapp") {
    return sendWhatsappCommunityText(contact.contactId, text);
  }
  if (contact.sourceChannel === "community_viber") {
    return sendViberCommunityText(contact.contactId, text);
  }
  return sendMetaMessengerText(contact.contactId, text);
}

export async function sendCommunityChannelButtons(params: {
  contact: CommunityChannelContact;
  text: string;
  buttons: MessengerPostbackButton[];
}): Promise<ChannelSendResult> {
  const mappedButtons = params.buttons.map((button) => ({
    id: button.payload,
    title: button.title,
  }));

  if (params.contact.sourceChannel === "community_whatsapp") {
    return sendWhatsappCommunityButtons({
      waId: params.contact.contactId,
      text: params.text,
      buttons: mappedButtons,
    });
  }
  if (params.contact.sourceChannel === "community_viber") {
    return sendViberCommunityButtons({
      viberUserId: params.contact.contactId,
      text: params.text,
      buttons: mappedButtons,
    });
  }
  return sendMetaMessengerButtonTemplate({
    recipientPsid: params.contact.contactId,
    text: params.text,
    buttons: params.buttons,
  });
}
