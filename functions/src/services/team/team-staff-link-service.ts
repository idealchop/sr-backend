import { createHash, randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { auth, db } from "../../config/firebase-admin";

/**
 * Staff access links (Barbers.ph-style "share to staff", Jimboy 2026-11-03).
 *
 * The owner shares a private link; the staff member opens it and is signed in as
 * their own rider seat with no password. Storage:
 *   staffAccessLinks/{sha256(token)}  { businessId, memberUid, createdBy, createdAt, expiresAt }
 *   businesses/{id}/members/{uid}.staffLinkHash  current link (one per member)
 * Only the hash is stored, so a database read never reveals a working link.
 * Regenerate replaces the hash (old link stops working); revoke deletes it. Both also
 * revoke the member's refresh tokens, so sessions opened from an old link end.
 * Only active `rider` seats qualify: never the owner, never an admin seat.
 */
export const STAFF_LINK_COLLECTION = "staffAccessLinks";
/** Links expire after 180 days (Barbers.ph asks owners to review every 6 months). */
export const STAFF_LINK_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const hashStaffLinkToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** 256-bit random, base64url (43 chars). */
export const newStaffLinkToken = () => randomBytes(32).toString("base64url");

export const isStaffLinkTokenShape = (token: unknown): token is string =>
  typeof token === "string" && TOKEN_RE.test(token);

type Fail = { ok: false; status: number; message: string };

async function eligibleMember(
  businessId: string,
  memberUid: string,
): Promise<Fail | { ok: true; ownerId: string }> {
  const businessRef = db.collection("businesses").doc(businessId);
  const [biz, member] = await Promise.all([
    businessRef.get(),
    businessRef.collection("members").doc(memberUid).get(),
  ]);
  if (!biz.exists) return { ok: false, status: 404, message: "Business not found" };
  const ownerId = String(biz.data()?.ownerId || "");
  if (!member.exists) {
    return { ok: false, status: 404, message: "Team member not found" };
  }
  const m = member.data() || {};
  if (memberUid === ownerId) {
    return { ok: false, status: 400, message: "The owner cannot get a staff link." };
  }
  if (String(m.role || "").toLowerCase() !== "rider") {
    return {
      ok: false,
      status: 400,
      message: "Staff links are only for staff (rider) seats, not admins.",
    };
  }
  if (m.isActive === false) {
    return { ok: false, status: 400, message: "This team member is inactive." };
  }
  return { ok: true, ownerId };
}

/** Owner: create or replace the member's link. Returns the raw token once. */
export async function createStaffLink(params: {
  businessId: string;
  memberUid: string;
  ownerUid: string;
  now?: number;
}): Promise<Fail | { ok: true; token: string; expiresAt: number }> {
  const check = await eligibleMember(params.businessId, params.memberUid);
  if (!check.ok) return check;
  const now = params.now ?? Date.now();
  const token = newStaffLinkToken();
  const hash = hashStaffLinkToken(token);
  const expiresAt = now + STAFF_LINK_TTL_MS;
  const memberRef = db
    .collection("businesses").doc(params.businessId)
    .collection("members").doc(params.memberUid);
  const prev = (await memberRef.get()).data()?.staffLinkHash;
  const batch = db.batch();
  if (typeof prev === "string" && prev) {
    batch.delete(db.collection(STAFF_LINK_COLLECTION).doc(prev));
  }
  batch.set(db.collection(STAFF_LINK_COLLECTION).doc(hash), {
    businessId: params.businessId,
    memberUid: params.memberUid,
    createdBy: params.ownerUid,
    createdAt: now,
    expiresAt,
  });
  batch.set(memberRef, {
    staffLinkHash: hash,
    staffLinkCreatedAt: now,
    staffLinkExpiresAt: expiresAt,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();
  if (prev) await auth.revokeRefreshTokens(params.memberUid).catch(() => undefined);
  return { ok: true, token, expiresAt };
}

/** Owner: turn off the member's link and end sessions opened with it. */
export async function revokeStaffLink(params: {
  businessId: string;
  memberUid: string;
}): Promise<Fail | { ok: true }> {
  const memberRef = db
    .collection("businesses").doc(params.businessId)
    .collection("members").doc(params.memberUid);
  const snap = await memberRef.get();
  if (!snap.exists) return { ok: false, status: 404, message: "Team member not found" };
  const prev = snap.data()?.staffLinkHash;
  const batch = db.batch();
  if (typeof prev === "string" && prev) {
    batch.delete(db.collection(STAFF_LINK_COLLECTION).doc(prev));
  }
  batch.set(memberRef, {
    staffLinkHash: FieldValue.delete(),
    staffLinkCreatedAt: FieldValue.delete(),
    staffLinkExpiresAt: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();
  if (prev) await auth.revokeRefreshTokens(params.memberUid).catch(() => undefined);
  return { ok: true };
}

/**
 * Public: exchange a link token for a Firebase custom token for that staff seat.
 * Every check is re-run at open time, so a deactivated, removed or promoted member's
 * link stops working at once.
 */
export async function exchangeStaffLink(
  token: unknown,
  now = Date.now(),
): Promise<Fail | { ok: true; customToken: string; businessId: string }> {
  const gone: Fail = {
    ok: false,
    status: 404,
    message: "This link was replaced or turned off. Ask your owner for a new one.",
  };
  if (!isStaffLinkTokenShape(token)) return gone;
  const hash = hashStaffLinkToken(token);
  const linkSnap = await db.collection(STAFF_LINK_COLLECTION).doc(hash).get();
  const link = linkSnap.data() as
    | { businessId?: string; memberUid?: string; expiresAt?: number }
    | undefined;
  if (!link?.businessId || !link.memberUid) return gone;
  if (typeof link.expiresAt === "number" && link.expiresAt <= now) {
    return {
      ok: false,
      status: 410,
      message: "This link has expired. Ask your owner to share a new one.",
    };
  }
  const check = await eligibleMember(link.businessId, link.memberUid);
  if (!check.ok) return gone;
  const member = await db
    .collection("businesses").doc(link.businessId)
    .collection("members").doc(link.memberUid).get();
  if (member.data()?.staffLinkHash !== hash) return gone;
  // Never hand out a session for an account that owns any workspace.
  const owns = await db
    .collection("businesses")
    .where("ownerId", "==", link.memberUid)
    .limit(1)
    .get();
  if (!owns.empty) return gone;
  const customToken = await auth.createCustomToken(link.memberUid, {
    staffLink: true,
    staffLinkBusinessId: link.businessId,
  });
  return { ok: true, customToken, businessId: link.businessId };
}
