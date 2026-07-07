import type { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { CollectionItem } from "../transactions/transaction-service";
import type { NearbyDormantOrderSpec } from "./rider-messenger-order-lines-service";

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

export type RiderMessengerNearbyRow = {
  index: number;
  source: "order" | "dormant";
  customerId: string;
  transactionId?: string;
  referenceId: string;
  customerName: string;
  type: "delivery" | "collection";
  distanceKm: number;
  assignedRiderName: string | null;
  isOverride: boolean;
  lat: number;
  lng: number;
  daysSinceLastOrder?: number;
};

export type RiderMessengerNearbyGroup = {
  groupNumber: number;
  label: string;
  stopCount: number;
  spanM: number;
  nearestDistanceKm: number;
  quietCount: number;
  members: Omit<RiderMessengerNearbyRow, "index">[];
};

export type RiderMessengerActiveList = "jobs" | "nearby" | "group_detail";

export type RiderMessengerSessionPending =
  | {
    kind: "confirm_done";
    transactionId: string;
    cashAmount?: number;
    deliveryProofUrl?: string;
  }
  | {
    kind: "await_reason";
    transactionId: string;
    targetStatus: "failed" | "cancelled";
    referenceId: string;
    awaitingOtherDetail?: boolean;
    reasonLabel?: string;
  }
  | {
    kind: "report_collect";
    transactionId: string;
    items: CollectionItem[];
    nextIndex: number;
  }
  | {
    kind: "await_group_reason";
    transactionIds: string[];
    referenceIds: string[];
    groupNumber: number;
    groupLabel: string;
    targetStatus: "failed" | "cancelled";
    awaitingOtherDetail?: boolean;
    reasonLabel?: string;
  }
  | {
    kind: "confirm_group_done";
    transactionIds: string[];
    referenceIds: string[];
    groupNumber: number;
    groupLabel: string;
    cashAmount?: number;
  }
  | {
    kind: "confirm_multi_done";
    transactionIds: string[];
    referenceIds: string[];
    targetLabel: string;
    cashAmount?: number;
  }
  | {
    kind: "await_multi_reason";
    transactionIds: string[];
    referenceIds: string[];
    targetLabel: string;
    targetStatus: "failed" | "cancelled";
    awaitingOtherDetail?: boolean;
    reasonLabel?: string;
  }
  | {
    kind: "confirm_order";
    customerId: string;
    target: string;
    orderSpec: NearbyDormantOrderSpec;
    summaryLines: string[];
    customerName: string;
    orderType: "delivery" | "collection";
    daysSinceLastOrder?: number;
  };

export type RiderMessengerSessionDoc = {
  businessId: string;
  riderId: string;
  lastJobs?: RiderMessengerJobRow[];
  lastNearbyGroups?: RiderMessengerNearbyGroup[];
  lastNearby?: RiderMessengerNearbyRow[];
  activeList?: RiderMessengerActiveList;
  activeGroupNumber?: number;
  lastRiderLat?: number;
  lastRiderLng?: number;
  chatMode?: boolean;
  pending?: RiderMessengerSessionPending | null;
  updatedAt: FieldValue | Timestamp;
};

export const RIDER_MESSENGER_POSTBACK_CONFIRM_YES = "RD_CONFIRM_YES";
export const RIDER_MESSENGER_POSTBACK_CONFIRM_NO = "RD_CONFIRM_NO";
export const RIDER_MESSENGER_POSTBACK_JOBS = "RD_JOBS";
export const RIDER_MESSENGER_POSTBACK_NEARBY = "RD_NEARBY";
export const RIDER_MESSENGER_POSTBACK_HELP = "RD_HELP";
