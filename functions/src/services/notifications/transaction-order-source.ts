import type { Transaction } from "../transactions/transaction-service";

/** How an income transaction entered the ledger (QR portal vs manual app entry). */
export type TransactionOrderSource =
  | "qr_order"
  | "qr_walkin"
  | "qr_collection"
  | "manual";

export function transactionOrderSourceLabel(
  source: TransactionOrderSource,
): string {
  switch (source) {
  case "qr_order":
    return "Order QR";
  case "qr_walkin":
    return "Walk-in QR";
  case "qr_collection":
    return "Collection QR";
  case "manual":
    return "Manual";
  default:
    return "Manual";
  }
}

function notesLower(tx: Partial<Transaction>): string {
  return String(tx.notes || "").toLowerCase();
}

/** Classify ledger transactions for notification copy and metadata. */
export function resolveTransactionOrderSource(
  tx: Partial<Transaction>,
): TransactionOrderSource | null {
  const notes = notesLower(tx);

  if (tx.type === "walkin" || tx.type === "direct_sale") {
    if (
      tx.walkInQueueNumber != null ||
      notes.includes("counter walk-in") ||
      notes.includes("walk-in order")
    ) {
      return "qr_walkin";
    }
    return "manual";
  }

  if (tx.type === "collection") {
    if (
      notes.includes("portal collection") ||
      notes.includes("collection request")
    ) {
      return "qr_collection";
    }
    return "manual";
  }

  if (tx.type === "delivery") {
    if (tx.deliveryStatus === "placed" || notes.includes("portal order")) {
      return "qr_order";
    }
    return "manual";
  }

  return null;
}

export function notificationTitleWithOrderSource(
  baseTitle: string,
  source: TransactionOrderSource | null,
): string {
  if (!source) return baseTitle;
  return `${transactionOrderSourceLabel(source)} · ${baseTitle}`;
}

export function mapPortalOrderKindToSource(
  portalOrderKind?: string,
): TransactionOrderSource | null {
  switch (portalOrderKind) {
  case "walkin":
    return "qr_walkin";
  case "collection":
    return "qr_collection";
  case "delivery":
    return "qr_order";
  default:
    return null;
  }
}
