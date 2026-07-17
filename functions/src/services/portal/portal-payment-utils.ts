import { isCashPaymentMethod } from "../transactions/rider-cash-payment";
import type { RawSubmissionPayload } from "./raw-submission-types";

/** @deprecated Prefer {@link isCashPaymentMethod} — kept for portal call sites. */
export function isPortalCashPaymentMethod(method: string | undefined): boolean {
  return isCashPaymentMethod(method);
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
  if (!isCashPaymentMethod(pay.method)) {
    return pay.confirmedByRider === true;
  }
  return pay.confirmedByRider !== false;
}
