import type { CommunityDispatchRequestDoc } from "./community-dispatch-request-types";

export type CommunitySourceChannel =
  | "community_messenger"
  | "community_whatsapp"
  | "community_viber";

export type CommunityChannelIdField = "metaPsid" | "whatsappWaId" | "viberUserId";

export type CommunityChannelContact = {
  sourceChannel: CommunitySourceChannel;
  contactId: string;
};

export function communityContactLegacyIdField(
  channel: CommunitySourceChannel,
): CommunityChannelIdField {
  if (channel === "community_whatsapp") return "whatsappWaId";
  if (channel === "community_viber") return "viberUserId";
  return "metaPsid";
}

export function readCommunityCustomerContact(
  doc: Pick<
    CommunityDispatchRequestDoc,
    "sourceChannel" | "metaPsid" | "whatsappWaId" | "viberUserId" | "channelContactId"
  >,
): CommunityChannelContact | null {
  const channel = doc.sourceChannel ?? "community_messenger";
  if (channel === "community_whatsapp") {
    const contactId = doc.whatsappWaId?.trim() || doc.channelContactId?.trim();
    return contactId ? { sourceChannel: "community_whatsapp", contactId } : null;
  }
  if (channel === "community_viber") {
    const contactId = doc.viberUserId?.trim() || doc.channelContactId?.trim();
    return contactId ? { sourceChannel: "community_viber", contactId } : null;
  }
  const contactId = doc.metaPsid?.trim() || doc.channelContactId?.trim();
  return contactId ? { sourceChannel: "community_messenger", contactId } : null;
}

export function buildCommunityChannelContact(params: {
  sourceChannel: CommunitySourceChannel;
  contactId: string;
}): CommunityChannelContact {
  return {
    sourceChannel: params.sourceChannel,
    contactId: params.contactId.trim(),
  };
}

export function channelContactFields(
  contact: CommunityChannelContact,
): {
  sourceChannel: CommunitySourceChannel;
  channelContactId: string;
  metaPsid?: string;
  whatsappWaId?: string;
  viberUserId?: string;
} {
  const field = communityContactLegacyIdField(contact.sourceChannel);
  return {
    sourceChannel: contact.sourceChannel,
    channelContactId: contact.contactId,
    [field]: contact.contactId,
  };
}
