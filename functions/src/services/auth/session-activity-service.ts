import type { Request } from "express";
import type { DecodedIdToken } from "firebase-admin/auth";
import { logger } from "firebase-functions";
import { db, FieldValue } from "../../config/firebase-admin";

/**
 * Throttle API-derived session pings per warm instance (best-effort sampling).
 * Daily dedupe in `writeUserLoginEvent` is authoritative across instances/devices.
 */
const API_ACCESS_THROTTLE_MS = 15 * 60 * 1000;
const lastApiAccessWriteAt = new Map<string, number>();

/** Treat as “long-lived session / cached client” when credentials are older than this. */
const CACHED_SESSION_AUTH_AGE_SEC = 3600;

/**
 * UTC calendar day `YYYY-MM-DD` — one login_events doc per user per day.
 * @param {Date} [now] Reference time (defaults to now).
 * @return {string} Day key.
 */
export function utcCalendarDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function isExplicitLoginPost(req: Request): boolean {
  if (req.method !== "POST") return false;
  const path = (req.originalUrl || req.url || req.path || "").split("?")[0];
  return path.endsWith("/auth/login");
}

function shouldThrottleApiAccess(uid: string): boolean {
  const last = lastApiAccessWriteAt.get(uid) ?? 0;
  if (Date.now() - last < API_ACCESS_THROTTLE_MS) return true;
  lastApiAccessWriteAt.set(uid, Date.now());
  return false;
}

/**
 * Persists at most one row per UTC day under users/{uid}/login_events/{YYYY-MM-DD}.
 * Subsequent sign-ins or API traffic the same day (any device/browser) are skipped.
 * @param {object} input Login event payload.
 * @param {string} input.uid Firebase user id.
 * @param {string} [input.email] User email.
 * @param {DecodedIdToken | null} [input.decoded] Decoded ID token.
 * @param {Request} input.req Express request.
 * @param {"explicit_login" | "cached_api_access" | "routine_api_access"} input.kind Event kind.
 * @param {string} [input.provider] Auth provider id.
 * @param {string} [input.appId] App id (default smartrefill).
 * @return {Promise<boolean>} True if a new daily event was written.
 */
export async function writeUserLoginEvent(input: {
  uid: string;
  email?: string;
  decoded?: DecodedIdToken | null;
  req: Request;
  kind: "explicit_login" | "cached_api_access" | "routine_api_access";
  provider?: string;
  appId?: string;
}): Promise<boolean> {
  const { uid, email, decoded, req, kind, provider, appId } = input;
  const nowSec = Math.floor(Date.now() / 1000);
  const authTimeSec = decoded?.auth_time ?? null;
  const iatSec = decoded?.iat ?? null;
  const authAgeSec =
    authTimeSec != null ? Math.max(0, nowSec - authTimeSec) : null;

  const dayKey = utcCalendarDayKey();
  const loginEventRef = db
    .collection("users")
    .doc(uid)
    .collection("login_events")
    .doc(dayKey);

  return db.runTransaction(async (tx) => {
    const existing = await tx.get(loginEventRef);
    if (existing.exists) {
      return false;
    }

    tx.set(loginEventRef, {
      calendarDayUtc: dayKey,
      timestamp: FieldValue.serverTimestamp(),
      kind,
      path: req.path || req.url || "",
      originalUrl: req.originalUrl || "",
      method: req.method,
      userAgent: String(req.headers["user-agent"] || "unknown"),
      ip: req.ip || req.socket?.remoteAddress || "unknown",
      provider: provider || decoded?.firebase?.sign_in_provider || "unknown",
      appId: appId || "smartrefill",
      email: email || decoded?.email || null,
      authTimeSec,
      tokenIssuedAtSec: iatSec,
      authAgeSec,
      tokenExpiresAtSec: decoded?.exp ?? null,
    });
    return true;
  });
}

/**
 * Fire-and-forget: records that a valid ID token was used against the API.
 * Skips POST /auth/login (handled by recordLoginEvent as explicit_login).
 * Throttled per instance; writes are capped to one per user per UTC day in Firestore.
 * @param {DecodedIdToken} decoded Verified Firebase ID token.
 * @param {Request} req Express request.
 */
export function scheduleApiSessionAccessRecord(
  decoded: DecodedIdToken,
  req: Request,
): void {
  if (!decoded?.uid) return;
  if (isExplicitLoginPost(req)) return;
  if (shouldThrottleApiAccess(decoded.uid)) return;

  const nowSec = Math.floor(Date.now() / 1000);
  const authTimeSec = decoded.auth_time;
  const authAgeSec =
    authTimeSec != null ? Math.max(0, nowSec - authTimeSec) : 0;
  const kind: "cached_api_access" | "routine_api_access" =
    authAgeSec > CACHED_SESSION_AUTH_AGE_SEC ?
      "cached_api_access" :
      "routine_api_access";

  void writeUserLoginEvent({
    uid: decoded.uid,
    email: decoded.email,
    decoded,
    req,
    kind,
    provider: decoded.firebase?.sign_in_provider,
  }).catch((err) => {
    logger.error("Failed to record API session access", {
      uid: decoded.uid,
      err,
    });
  });
}
