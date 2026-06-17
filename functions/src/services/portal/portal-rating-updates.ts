import type { RawSubmissionPayload } from "./raw-submission-types";

/**
 * Normalizes a portal star rating to 1–5 or returns undefined when absent/invalid.
 * @param {unknown} n Raw payload value.
 * @return {number|undefined}
 */
export function normalizePortalStarRating(n: unknown): number | undefined {
  if (n === undefined || n === null || n === "") return undefined;
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v < 1 || v > 5) return undefined;
  return v;
}

/**
 * True when the transaction already has portal star ratings or written feedback.
 * @param {object} tx Transaction fields that may carry ratings.
 * @return {boolean}
 */
export function transactionHasCustomerRating(tx: {
  serviceRating?: unknown;
  wrsRating?: unknown;
  riderRating?: unknown;
  rating?: unknown;
  feedback?: unknown;
}): boolean {
  const service = normalizePortalStarRating(tx.serviceRating ?? tx.rating);
  const wrs = normalizePortalStarRating(tx.wrsRating);
  const rider = normalizePortalStarRating(tx.riderRating);
  const feedback =
    typeof tx.feedback === "string" ? tx.feedback.trim() : "";
  return Boolean(service || wrs || rider || feedback);
}

/**
 * Firestore patch fields for `serviceRating`, `riderRating`, legacy `rating`, and `feedback`
 * from a portal submission payload.
 * @param {RawSubmissionPayload} payload Portal payload.
 * @return {Record<string, unknown>}
 */
export function ratingPatchFromPortalPayload(
  payload: RawSubmissionPayload,
): Record<string, unknown> {
  const service = normalizePortalStarRating(
    payload.serviceRating ?? payload.rating,
  );
  const wrs = normalizePortalStarRating(payload.wrsRating);
  const rider = normalizePortalStarRating(payload.riderRating);
  const updates: Record<string, unknown> = {};
  if (service !== undefined) {
    updates.serviceRating = service;
    updates.rating = service;
  }
  if (wrs !== undefined) {
    updates.wrsRating = wrs;
  }
  if (rider !== undefined) {
    updates.riderRating = rider;
  }
  if (typeof payload.feedback === "string" && payload.feedback.trim()) {
    updates.feedback = payload.feedback.trim().slice(0, 500);
  }
  return updates;
}
