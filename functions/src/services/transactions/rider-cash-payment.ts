/**
 * Cash / rider-received payment helpers for ledger create paths.
 * Keep semantics in sync with frontend
 * `features/transactions/lib/rider-cash-payment.ts`
 * (`isCashStoredPaymentMethod` / `staffPaymentConfirmedByRider`).
 */
export function isCashPaymentMethod(method: string | undefined): boolean {
  return String(method ?? "cash").trim().toLowerCase() === "cash";
}

export function staffPaymentConfirmedByRider(payment: {
  method?: string;
  confirmedByRider?: boolean;
}): boolean {
  if (!isCashPaymentMethod(payment.method)) {
    return payment.confirmedByRider === true;
  }
  return payment.confirmedByRider !== false;
}

export function initialPaymentNotesForCreate(
  method: string,
  riderId: string | undefined,
): string {
  if (riderId && isCashPaymentMethod(method)) {
    return "Cash: confirmed received by rider";
  }
  return "Initial payment";
}

export function initialPaymentConfirmedByRider(
  method: string,
  riderId: string | undefined,
): boolean | undefined {
  if (riderId && isCashPaymentMethod(method)) {
    return true;
  }
  return undefined;
}
