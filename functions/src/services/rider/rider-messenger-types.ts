import type { FieldValue, Timestamp } from "firebase-admin/firestore";

export type RiderMessengerLinkDoc = {
  businessId: string;
  riderId: string;
  riderName: string;
  stationLabel: string;
  linkedAt: FieldValue | Timestamp;
};

export type RiderMessengerLinkCodeDoc = {
  riderId: string;
  riderName: string;
  expiresAt: Timestamp;
  usedAt?: Timestamp | null;
  createdAt: FieldValue | Timestamp;
};

export type RiderMessengerJobRow = {
  index: number;
  transactionId: string;
  referenceId: string;
  customerName: string;
  type: "delivery" | "collection";
  status: string;
  itemsSummary: string;
  phone?: string;
  isTodo: boolean;
  isDoneToday: boolean;
};

export type RiderMessengerSessionDoc = {
  businessId: string;
  riderId: string;
  lastJobs?: RiderMessengerJobRow[];
  pending?: {
    kind: "confirm_done" | "confirm_fail" | "confirm_cancel" | "await_reason";
    transactionId: string;
    targetStatus?: "completed" | "failed" | "cancelled";
  } | null;
  updatedAt: FieldValue | Timestamp;
};

export const RIDER_MESSENGER_POSTBACK_CONFIRM_YES = "RD_CONFIRM_YES";
export const RIDER_MESSENGER_POSTBACK_CONFIRM_NO = "RD_CONFIRM_NO";
export const RIDER_MESSENGER_POSTBACK_JOBS = "RD_JOBS";
export const RIDER_MESSENGER_POSTBACK_HELP = "RD_HELP";
