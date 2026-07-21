/**
 * Transaction domain types (ledger). Kept separate from TransactionService
 * so callers can import types without loading the god service module graph.
 */

export interface TransactionRefill {
  waterTypeId: string;
  name?: string;
  /** Delivered gallons (paid + free bonus when applicable). */
  quantity: number;
  unitPrice: number;
  subtotal: number;
  /** Gallons charged; omit on legacy rows (derived from subtotal / unitPrice). */
  paidQuantity?: number;
}

export interface TransactionInventoryItem {
  inventoryId: string;
  name?: string;
  quantity: number;
  unitPrice?: number;
  subtotal?: number;
  itemId?: string; // Added for backward compatibility
}

export interface TransactionPayment {
  id: string;
  amount: number;
  date: any;
  method: string;
  notes?: string;
  /** Cash (pay rider): treated as received unless explicitly `false`. */
  confirmedByRider?: boolean;
  /**
   * Soft-deleted correction row. Excluded from active paid totals / revenue.
   * Prefer setting via payment replace APIs; do not delete historical rows.
   */
  voided?: boolean;
}

export type CollectionItemStatus =
  | "pending"
  | "ok"
  | "damaged"
  | "missing"
  | "recovered";

export interface CollectionItem {
  inventoryId: string;
  name: string;
  qtyExpected: number;
  qtyCollected: number;
  qtyOk: number;
  qtyDamaged: number;
  qtyMissing: number;
  deficitQty: number; // Current deficit (qtyExpected - qtyOk)
  status: CollectionItemStatus;
  replacedFromInventory?: boolean; // Flag to indicate if a damaged or missing item was replaced
  recoveredFromTxIds?: string[]; // IDs of past transactions this item recovered debt FROM
  recoveryLinks?: { txId: string; amount: number }[]; // Debt recovered FROM this item
  notes?: string;
}

export interface Transaction {
  id?: string;
  businessId: string;
  referenceId: string;
  type: "delivery" | "walkin" | "direct_sale" | "expense" | "collection";
  customerId?: string;
  customerName: string;
  waterRefills?: TransactionRefill[];
  items?: TransactionInventoryItem[];
  collectionItems?: CollectionItem[];
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: "paid" | "partial" | "unpaid" | "N/A";
  paymentMethod: "cash" | "digital_wallet" | "bank_transfer" | "other";
  payments?: TransactionPayment[];
  deliveryStatus:
    | "pending"
    | "placed"
    | "in-transit"
    | "delivered"
    | "collected"
    | "failed"
    | "cancelled"
    | "completed";
  riderId?: string;
  /** Denormalized rider display name (set when `riderId` is assigned). */
  riderName?: string;
  linkedTransactionId?: string;
  notes?: string;
  scheduledAt?: any;
  /** Set when the stop first moves to `in-transit` (rider en route / at stop). */
  arrivedAt?: any;
  deliveredAt?: any;
  /** Manual dispatch stop order within a rider route (lower = earlier). */
  routeSequence?: number | null;
  /** Counter walk-in queue ticket for the Manila business day. */
  walkInQueueNumber?: number;
  attachmentUrl?: string;
  /**
   * Customer portal: photo of received items at completion
   * (distinct from payment transfer proof).
   */
  deliveryProofUrl?: string;
  signatureUrl?: string;
  expenseCategory?: string;
  /** Salary expenses — Team Hub (`member:` / `rider:`) or expense-only (`salary:`). */
  expenseStaffId?: string;
  /** Denormalized staff display name for salary expenses. */
  expenseStaffName?: string;
  /** @deprecated Prefer `serviceRating`; kept for legacy rows and portal backward compatibility. */
  rating?: number;
  /** Customer-rated station / fulfillment quality (1–5). */
  serviceRating?: number;
  /** Customer-rated WRS / station quality (1–5). */
  wrsRating?: number;
  /** Customer-rated rider experience when a rider was involved (1–5). */
  riderRating?: number;
  feedback?: string;
  /**
   * Portal delivery speed after advance payment.
   * `priority` ≈ 30–60 min; `express` ≈ 1–2 h; `standard` ≈ 4–6 h.
   */
  deliverySpeed?: "priority" | "express" | "standard";
  /** Station fee for priority/express (included in `totalAmount`). */
  deliverySpeedFee?: number;
  /**
   * Customer tip for the rider — **excluded from `totalAmount` / station revenue**.
   * Included in the customer's transfer for settlement tracking only; 100% to rider
   * (never commission base).
   */
  riderTipAmount?: number;
  createdAt?: any;
  updatedAt?: any;
  /** Offline outbox idempotency key (unique per business when set). */
  clientMutationId?: string;
  /**
   * When false, delivery line items have not yet been deducted from inventory
   * (deferred until the order leaves `pending`). Omitted/undefined means legacy
   * behaviour: stock was applied at transaction creation.
   */
  salesStockApplied?: boolean;
  riderContainerDueDiligence?: import("./delivery-rider-due-diligence").RiderContainerDueDiligence;
}

export type AddTransactionResult = {
  transaction: Transaction;
  created: boolean;
};
