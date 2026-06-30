/** Eligible WRS row for community routing (CP-06). */
export type CommunityWrsDirectoryEntry = {
  businessId: string;
  name: string;
  publicName: string;
  slug?: string;
  lat: number;
  lng: number;
  acceptingOrders: boolean;
};

export type CommunityDispatchRoutingMode = "broadcast";

export type CommunityDispatchRequestStatus =
  | "parsed"
  | "needs_location"
  | "no_stations"
  | "routing"
  | "offered"
  | "accepted"
  | "expired"
  | "cancelled";

export type CommunityDispatchGeocode = {
  latitude: number;
  longitude: number;
  formattedAddress?: string;
};

export type CommunityDispatchParseSource = "template" | "ai";

export type CommunityDispatchRequestDoc = {
  status: CommunityDispatchRequestStatus;
  sourceChannel: "community_messenger" | "community_whatsapp";
  /** Unified lookup key — PSID or WhatsApp wa_id. */
  channelContactId?: string;
  metaPsid?: string;
  whatsappWaId?: string;
  metaMessageId: string;
  rawMessage: string;
  parsed: import("./community-dispatch-template-parser").CommunityOrderFields;
  parseSource: CommunityDispatchParseSource;
  referenceId: string;
  routingMode?: CommunityDispatchRoutingMode;
  geocode?: CommunityDispatchGeocode;
  candidateBusinessIds?: string[];
  activeOfferId?: string;
  assignedBusinessId?: string;
  smartrefillSubmissionId?: string;
  submissionReferenceId?: string;
  deliveryNotifiedAt?: unknown;
  /** Current broadcast search radius in km (5 → 10 → 15). */
  searchRadiusKm?: number;
  /** True once any station was found within any search radius. */
  stationsFoundEver?: boolean;
  routingNotes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type CreateCommunityDispatchRequestResult = {
  id: string;
  referenceId: string;
  created: boolean;
};

/** Human-friendly reference shown in Messenger confirmation (CP-05). */
export function formatCommunityRequestReference(docId: string): string {
  const suffix = docId.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase();
  return `CR-${suffix || "ORDER"}`;
}

export type CommunityDispatchOfferStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "expired"
  | "superseded";

export type CommunityDispatchOfferDoc = {
  requestId: string;
  businessId: string;
  status: CommunityDispatchOfferStatus;
  rank: number;
  expiresAt: unknown;
  acceptedByUid?: string;
  declineReason?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};
