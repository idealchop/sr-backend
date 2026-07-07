import type { FieldValue, Timestamp } from "firebase-admin/firestore";

export type TeamMessengerLinkDoc = {
  businessId: string;
  userId: string;
  memberName: string;
  role: "owner" | "admin";
  stationLabel: string;
  linkedAt: FieldValue | Timestamp;
};

export type TeamMessengerLinkCodeDoc = {
  userId: string;
  memberName: string;
  role: "owner" | "admin";
  expiresAt: Timestamp;
  usedAt?: Timestamp | null;
  createdAt: FieldValue | Timestamp;
};

export type TeamMessengerSessionDoc = {
  businessId: string;
  userId: string;
  memberName: string;
  chatMode: boolean;
  activeRiderPsid?: string;
  activeRiderId?: string;
  activeRiderName?: string;
  /** Owner↔customer delivery chat (separate from rider team chat). */
  deliveryChatMode?: boolean;
  deliveryChatThreadId?: string;
  deliveryChatCustomerName?: string;
  deliveryChatReferenceId?: string;
  updatedAt: FieldValue | Timestamp;
};

export const TEAM_MESSENGER_POSTBACK_CHAT = "TM_CHAT";
export const TEAM_MESSENGER_POSTBACK_CLOSE = "TM_CLOSE";
