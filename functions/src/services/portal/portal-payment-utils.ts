import type { RawSubmissionPayload } from "./raw-submission-types";

export function isPortalCashPaymentMethod(method: string | undefined): boolean {
  const m = String(method ?? "cash")
    .trim()
    .toLowerCase();
  return m === "cash";
}

/**
 * Portal "Cash (pay rider)" is treated as received by the rider unless explicitly denied.
 * @param {object} [pay] Portal payment block from raw submission.
 * @return {boolean}
 */
export function portalPaymentConfirmedByRider(
  pay: RawSubmissionPayload["payment"] | undefined,
): boolean {
  if (!pay) return false;
  if (!isPortalCashPaymentMethod(pay.method)) {
    return pay.confirmedByRider === true;
  }
  return pay.confirmedByRider !== false;
}
