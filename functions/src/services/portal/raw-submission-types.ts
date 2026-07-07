import {
  TransactionRefill,
  TransactionInventoryItem,
  CollectionItem,
  TransactionPayment,
} from "../transactions/transaction-service";

export type RawSubmissionType =
  | "PROFILE_UPDATE"
  | "PLACE_ORDER"
  | "REQUEST_COLLECTION"
  /** @deprecated Legacy; portal now sends MARK_TX_COMPLETE. */
  | "COMPLETE_TX"
  /**
   * Customer requests staff to finalize a delivered/collected order
   * (payment + proof + signature).
   */
  | "MARK_TX_COMPLETE"
  /** Customer remits remaining / partial payment after delivery is already completed. */
  | "PORTAL_PAY_BALANCE"
  /** Customer sets preferred delivery/collection cadence (no one-off order date). */
  | "PORTAL_PREFERRED_SCHEDULE"
  /** Customer declares WRS vs own-gallon container policy (optional BYOG inventory). */
  | "PORTAL_CONTAINER_SETUP"
  /** Customer submits or updates service/rider ratings (no staff review). */
  | "PORTAL_TX_RATINGS";

/** Legacy Firestore values may include `rejected`; new declines use `cancelled` only. */
export type RawSubmissionStatus =
  | "pending_review"
  | "processed"
  | "rejected"
  | "cancelled";

export interface RawSubmissionPayload {
  profile?: {
    name?: string;
    phone?: string;
    email?: string;
    sukiType?: "personal" | "commercial";
    companyName?: string;
    [key: string]: any;
  };
  refillItems?: Array<{ type: string; qty: number; unitPrice?: number }>;
  inventoryItems?: Array<{ inventoryId: string; qty: number; unitPrice?: number }>;
  returnContainers?: Array<{ inventoryId: string; qty: number }>;
  address?: {
    line?: string;
    latitude?: number;
    longitude?: number;
    /** User-confirmed text; never overwrite silently. */
    formatted?: string;
  };
  payment?: {
    amountPaid?: number;
    method?: string;
    proofUrl?: string;
    reference?: string;
    date?: string;
    confirmedByRider?: boolean;
  };
  /** Order total when known (portal estimate). */
  totalAmount?: number;
  signatureDataUrl?: string;
  /** Photo of received items when customer completes a delivery via portal. */
  deliveryProofUrl?: string;
  targetTransactionId?: string;
  /** Same value as the linked transaction's `referenceId` (customer-facing TX-… id). */
  transactionReferenceId?: string;
  notes?: string;
  /** Collection-only request flag */
  collectionOnly?: boolean;
  /** @deprecated Prefer `serviceRating`. */
  rating?: number;
  serviceRating?: number;
  /** Customer-rated WRS / station quality (1–5). */
  wrsRating?: number;
  riderRating?: number;
  feedback?: string;
  /** Analytics source when saving to `portal_order_ratings`. */
  portalRatingSource?:
    | "portal_track_complete"
    | "portal_balance_pay"
    | "portal_ratings"
    | "portal_counter_walkin";
  /** Portal track: advance (pre-delivery) vs balance (post-delivery) payment. */
  portalPaymentPhase?: "advance" | "balance";
  /** Portal: recurring delivery/collection preferences. */
  schedule?: {
    isDeliveryEnabled?: boolean;
    isCollectionEnabled?: boolean;
    deliveryConfig?: Record<string, unknown>;
    collectionConfig?: Record<string, unknown>;
  };
  /** Portal: customer container policy and BYOG inventory declaration. */
  containerSetup?: {
    containerPolicy: "byog" | "wrs_rotation";
    ownContainers?: Array<{
      inventoryId: string;
      itemName?: string;
      quantity: number;
    }>;
  };
  /** Portal track quick actions: linked suki when QR session is absent. */
  customerIdHint?: string;

  /** Full Transaction alignment fields */
  type?: "delivery" | "walkin" | "direct_sale" | "expense" | "collection";
  waterRefills?: TransactionRefill[];
  items?: TransactionInventoryItem[];
  collectionItems?: CollectionItem[];
  amountPaid?: number;
  balanceDue?: number;
  paymentStatus?: "paid" | "partial" | "unpaid" | "N/A";
  paymentMethod?: "cash" | "digital_wallet" | "bank_transfer" | "other";
  payments?: TransactionPayment[];
  deliveryStatus?:
    | "pending"
    | "placed"
    | "in-transit"
    | "delivered"
    | "collected"
    | "failed"
    | "cancelled"
    | "completed";
  riderId?: string;
  riderName?: string;
  linkedTransactionId?: string;
  scheduledAt?: any;
  deliveredAt?: any;
  attachmentUrl?: string;
  signatureUrl?: string;
  expenseCategory?: string;
}

/**
 * Portal vs dashboard: fulfillment path (`delivery` or `collection`).
 */
export type PortalTransactionKind = "delivery" | "collection";

export interface RawSubmission {
  id?: string;
  businessId: string;
  customerId: string;
  referenceId: string;
  submissionType: RawSubmissionType;
  /**
   * Staff fulfillment: Add Delivery vs Add Collection.
   * Set at create time; older rows omit and use line-item heuristics.
   */
  transactionType?: PortalTransactionKind;
  status: RawSubmissionStatus;
  payload: RawSubmissionPayload;
  metadata: {
    legalAgreed: boolean;
    submittedAt?: unknown;
    userAgent?: string;
    /** @deprecated Legacy portal completion merge; no longer written. */
    portalCompletionAt?: unknown;
    /** @deprecated Was used with a Firestore trigger; no longer written. */
    portalCompletionPending?: boolean;
    portalCompletionProcessedAt?: unknown;
    portalCompletionError?: string;
    /** Set when staff merges profile into customer; hides repeat merge step in dashboard. */
    profileMergedAt?: unknown;
    /** Set when accept() creates a new customer from the portal submission (order tracker copy). */
    customerRegisteredAt?: unknown;
    /** Portal PLACE_ORDER or REQUEST_COLLECTION over plan cap; hidden from staff until upgrade. */
    overOnlineOrderLimit?: boolean;
    /** Counter walk-in vs delivery/collection channel for staff triage. */
    portalOrderKind?: "walkin" | "delivery" | "collection";
    /** Counter QR: daily queue ticket (Manila day; resets at midnight). */
    walkInQueueNumber?: number;
    walkInQueueDate?: string;
    /** `recognized` when linked via QR; `new` when anonymous at submit time. */
    portalCustomerStatus?: "recognized" | "new";
    /** CP-14 / CP-16 — community Page Messenger intake. */
    sourceChannel?: "community_messenger";
    communityDispatchRequestId?: string;
    communityReferenceId?: string;
    communityAcceptedByUid?: string;
  };
  submittedAt?: unknown;
  stockCheckPreview?: {
    ok: boolean;
    messages: string[];
  };
  processedAt?: unknown;
  processedByUid?: string;
  /** Note when submission was cancelled (station or customer); shown on track order. */
  rejectReason?: string;
}
