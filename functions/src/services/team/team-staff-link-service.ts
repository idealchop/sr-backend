import { createHash, randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { auth, db } from "../../config/firebase-admin";
import { completeStaffOnboarding } from "./team-invite-accept-service";

/**
 * Staff access links (Barbers.ph-style "share to staff", Jimboy 2026-11-03; reuse t80u).
 *
 * The owner shares one private link; the staff member opens it and is signed in as
 * their own rider seat with no password. Copying the link again returns that same
 * link. It does not mint a replacement or end sessions opened from it.
 *
 * Storage:
 *   staffAccessLinks/{sha256(token)}  server-only doc. New links also store `token`
 *     so the owner can copy the same URL. This collection is not a client-readable
 *     member document — never copy `token` onto businesses/{id}/members/{uid}.
 *   businesses/{id}/members/{uid}.staffLinkHash  current link hash (one per member).
 *     The hash is not a working URL. Historical rows have no `token`; those URLs
 *     keep working and are not rotated just to make a copy.
 * Explicit revoke deletes the hash and the server doc, and revokes refresh tokens.
 * Only active `rider` seats qualify: never the owner, never an admin seat.
 */
export const STAFF_LINK_COLLECTION = "staffAccessLinks";
/** Links expire after 180 days (Barbers.ph asks owners to review every 6 months). */
export const STAFF_LINK_TTL_MS = 180 * 24 * 60 * 60 * 1000;
/** Frontend active-link copy treats this 409 as "do not mint a replacement". */
export const STAFF_LINK_IRRECOVERABLE_CODE = "staff_link_irrecoverable";
export const STAFF_LINK_EXPIRED_CODE = "staff_link_expired";
export const STAFF_LINK_MISSING_CODE = "staff_link_missing";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const IRRECOVERABLE_MESSAGE =
  "This staff link was created before it could be copied again. It still works for anyone who already has it, but it cannot be shown. Turn the link off if you need to share a new one.";
const EXPIRED_MESSAGE =
  "This staff link has expired. Turn it off, then share a new one.";
const MISSING_MESSAGE = "This team member does not have a staff link yet.";

export const hashStaffLinkToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** 256-bit random, base64url (43 chars). */
export const newStaffLinkToken = () => randomBytes(32).toString("base64url");

export const isStaffLinkTokenShape = (token: unknown): token is string =>
  typeof token === "string" && TOKEN_RE.test(token);

export type StaffLinkFailure = {
  ok: false;
  status: number;
  message: string;
  code?: string;
};

export type StaffLinkSuccess = {
  ok: true;
  token: string;
  expiresAt: number;
  /** False when the existing link was returned and nothing was written. */
  issued: boolean;
};

export type StaffLinkResult = StaffLinkFailure | StaffLinkSuccess;

type MemberData = Record<string, unknown> | undefined;

function irrecoverable(): StaffLinkFailure {
  return {
    ok: false,
    status: 409,
    code: STAFF_LINK_IRRECOVERABLE_CODE,
    message: IRRECOVERABLE_MESSAGE,
  };
}

function expiredLink(): StaffLinkFailure {
  return {
    ok: false,
    status: 410,
    code: STAFF_LINK_EXPIRED_CODE,
    message: EXPIRED_MESSAGE,
  };
}

function evaluateSeat(
  businessExists: boolean,
  ownerId: string,
  memberExists: boolean,
  member: MemberData,
  memberUid: string,
): StaffLinkFailure | { ok: true } {
  if (!businessExists) {
    return { ok: false, status: 404, message: "Business not found" };
  }
  if (!memberExists) {
    return { ok: false, status: 404, message: "Team member not found" };
  }
  const m = member || {};
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
  return { ok: true };
}

async function eligibleMember(
  businessId: string,
  memberUid: string,
): Promise<StaffLinkFailure | { ok: true; ownerId: string }> {
  const businessRef = db.collection("businesses").doc(businessId);
  const [biz, member] = await Promise.all([
    businessRef.get(),
    businessRef.collection("members").doc(memberUid).get(),
  ]);
  const ownerId = String(biz.data()?.ownerId || "");
  const gate = evaluateSeat(
    biz.exists,
    ownerId,
    member.exists,
    member.data() as MemberData,
    memberUid,
  );
  if (!gate.ok) return gate;
  return { ok: true, ownerId };
}

function memberRef(businessId: string, memberUid: string) {
  return db.collection("businesses").doc(businessId).collection("members").doc(memberUid);
}

function linkRef(hash: string) {
  return db.collection(STAFF_LINK_COLLECTION).doc(hash);
}

/**
 * Read a stored link without writing. Hash-only rows stay in place.
 * A stored token is returned only when it hashes to the doc id and belongs
 * to this business and member.
 */
function resolveStoredLink(
  hash: string,
  data: MemberData,
  businessId: string,
  memberUid: string,
  now: number,
): StaffLinkFailure | { token: string; expiresAt: number } {
  if (!data) return irrecoverable();
  if (data.businessId !== businessId || data.memberUid !== memberUid) {
    return irrecoverable();
  }
  if (typeof data.expiresAt === "number" && data.expiresAt <= now) {
    return expiredLink();
  }
  const token = data.token;
  if (!isStaffLinkTokenShape(token) || hashStaffLinkToken(token) !== hash) {
    return irrecoverable();
  }
  const expiresAt = typeof data.expiresAt === "number" ?
    data.expiresAt :
    now + STAFF_LINK_TTL_MS;
  return { token, expiresAt };
}

/** Owner: return the current link. Never creates, rotates, or revokes. */
export async function getStaffLink(params: {
  businessId: string;
  memberUid: string;
  now?: number;
}): Promise<StaffLinkResult> {
  const now = params.now ?? Date.now();
  const check = await eligibleMember(params.businessId, params.memberUid);
  if (!check.ok) return check;
  const snap = await memberRef(params.businessId, params.memberUid).get();
  const hash = snap.data()?.staffLinkHash;
  if (typeof hash !== "string" || !hash) {
    return { ok: false, status: 404, code: STAFF_LINK_MISSING_CODE, message: MISSING_MESSAGE };
  }
  const linkSnap = await linkRef(hash).get();
  const resolved = resolveStoredLink(
    hash,
    linkSnap.data() as MemberData,
    params.businessId,
    params.memberUid,
    now,
  );
  if ("ok" in resolved) return resolved;
  return { ok: true, token: resolved.token, expiresAt: resolved.expiresAt, issued: false };
}

/**
 * Owner: issue a link once. A later call returns the same token and does not
 * revoke refresh tokens. Concurrent callers share one transaction outcome.
 * A hash-only (legacy) link is left untouched.
 */
export async function createStaffLink(params: {
  businessId: string;
  memberUid: string;
  ownerUid: string;
  now?: number;
}): Promise<StaffLinkResult> {
  const pre = await eligibleMember(params.businessId, params.memberUid);
  if (!pre.ok) return pre;
  const now = params.now ?? Date.now();
  const token = newStaffLinkToken();
  const hash = hashStaffLinkToken(token);
  const expiresAt = now + STAFF_LINK_TTL_MS;
  const businessRef = db.collection("businesses").doc(params.businessId);
  const seatRef = memberRef(params.businessId, params.memberUid);

  return db.runTransaction(async (tx) => {
    const [bizSnap, memberSnap] = await Promise.all([
      tx.get(businessRef),
      tx.get(seatRef),
    ]);
    const gate = evaluateSeat(
      bizSnap.exists,
      String(bizSnap.data()?.ownerId || ""),
      memberSnap.exists,
      memberSnap.data() as MemberData,
      params.memberUid,
    );
    if (!gate.ok) return gate;

    const prev = memberSnap.data()?.staffLinkHash;
    if (typeof prev === "string" && prev) {
      const linkSnap = await tx.get(linkRef(prev));
      const resolved = resolveStoredLink(
        prev,
        linkSnap.data() as MemberData,
        params.businessId,
        params.memberUid,
        now,
      );
      if ("ok" in resolved) return resolved;
      return {
        ok: true,
        token: resolved.token,
        expiresAt: resolved.expiresAt,
        issued: false,
      };
    }

    // Token lives only on the server link doc, never on the member document.
    tx.set(linkRef(hash), {
      businessId: params.businessId,
      memberUid: params.memberUid,
      createdBy: params.ownerUid,
      createdAt: now,
      expiresAt,
      token,
    });
    tx.set(seatRef, {
      staffLinkHash: hash,
      staffLinkCreatedAt: now,
      staffLinkExpiresAt: expiresAt,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true, token, expiresAt, issued: true };
  });
}

/** Owner: turn off the member's link and end sessions opened with it. */
export async function revokeStaffLink(params: {
  businessId: string;
  memberUid: string;
}): Promise<StaffLinkFailure | { ok: true }> {
  const seatRef = memberRef(params.businessId, params.memberUid);
  const snap = await seatRef.get();
  if (!snap.exists) return { ok: false, status: 404, message: "Team member not found" };
  const prev = snap.data()?.staffLinkHash;
  const batch = db.batch();
  if (typeof prev === "string" && prev) {
    batch.delete(linkRef(prev));
  }
  batch.set(seatRef, {
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
 * link stops working at once. Hash-only historical links stay valid until then.
 */
export async function exchangeStaffLink(
  token: unknown,
  now = Date.now(),
): Promise<StaffLinkFailure | { ok: true; customToken: string; businessId: string }> {
  const gone: StaffLinkFailure = {
    ok: false,
    status: 404,
    message: "This link was replaced or turned off. Ask your owner for a new one.",
  };
  if (!isStaffLinkTokenShape(token)) return gone;
  const hash = hashStaffLinkToken(token);
  const linkSnap = await linkRef(hash).get();
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
  const member = await memberRef(link.businessId, link.memberUid).get();
  if (member.data()?.staffLinkHash !== hash) return gone;
  // Never hand out a session for an account that owns any workspace.
  const owns = await db
    .collection("businesses")
    .where("ownerId", "==", link.memberUid)
    .limit(1)
    .get();
  if (!owns.empty) return gone;
  // Link-only staff (added by name, no email) never see the profile step.
  if (member.data()?.linkOnly === true) {
    await completeStaffOnboarding(link.memberUid, link.businessId).catch(() => undefined);
  }
  const customToken = await auth.createCustomToken(link.memberUid, {
    staffLink: true,
    staffLinkBusinessId: link.businessId,
  });
  return { ok: true, customToken, businessId: link.businessId };
}
