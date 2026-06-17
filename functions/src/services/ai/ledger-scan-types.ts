export type LedgerTransactionType =
  | "delivery"
  | "walkin"
  | "collection"
  | "expense";

/** @deprecated Legacy extract label — normalized to delivery or walkin */
export type LegacyLedgerTransactionType = "Sale" | "Expense";

export type ExtractedLedgerInventoryLine = {
  itemName: string;
  count: number;
  inventoryItemId: string;
  isNew?: boolean;
};

export type ExtractedLedgerRow = {
  transactionType: LedgerTransactionType | LegacyLedgerTransactionType;
  customerName: string;
  customerPhone?: string;
  customerId?: string;
  bottleQuantity?: number;
  amount?: number;
  date: string;
  address?: string;
  /** @deprecated Use deliveryStatus */
  status?: "Refill Completed" | "Order Placed";
  deliveryStatus?: "delivered" | "pending";
  paymentStatus?: "paid" | "partial" | "unpaid";
  paymentMethod?: "Cash" | "Online Payment" | "Not Paid";
  isNewCustomer?: boolean;
  matchedExisting?: boolean;
  notes?: string;
};

export type ExtractedLedgerResponse = {
  transactions: ExtractedLedgerRow[];
  inventoryLines?: ExtractedLedgerInventoryLine[];
  parseWarnings?: string[];
};
