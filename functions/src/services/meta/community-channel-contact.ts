import type { CommunityDispatchRequestDoc } from "./community-dispatch-request-types";

export type CommunitySourceChannel = "community_messenger" | "community_whatsapp";

export type CommunityChannelContact = {
  sourceChannel: CommunitySourceChannel;
  contactId: string;
};

export function readCommunityCustomerContact(
  doc: Pick<
    CommunityDispatchRequestDoc,
    "sourceChannel" | "metaPsid" | "whatsappWaId" | "channelContactId"
  >,
): CommunityChannelContact | null {
  const channel = doc.sourceChannel ?? "community_messenger";
  if (channel === "community_whatsapp") {
    const contactId = doc.whatsappWaId?.trim() || doc.channelContactId?.trim();
    return contactId ? { sourceChannel: "community_whatsapp", contactId } : null;
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
): Pick<CommunityDispatchRequestDoc, "sourceChannel" | "metaPsid" | "whatsappWaId" | "channelContactId"> {
  return {
    sourceChannel: contact.sourceChannel,
    channelContactId: contact.contactId,
    ...(contact.sourceChannel === "community_whatsapp" ?
      { whatsappWaId: contact.contactId } :
      { metaPsid: contact.contactId }),
  };
}
