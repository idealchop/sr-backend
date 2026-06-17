import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { RiderService } from "../riders/rider-service";
import { mergeGrantedSmartrefillAppAccess } from "./workspace-member-access";
import { normalizeSeatRole, type TeamSeatRole } from "./team-seat-roles";

export interface TeamInvitePreview {
  businessId: string;
  businessName: string;
  inviteeEmail: string;
  inviteeName: string | null;
  role: TeamSeatRole;
  status: string;
  expired: boolean;
}

export interface AcceptTeamInviteInput {
  token: string;
  uid: string;
  email: string;
  displayName: string;
}

export interface AcceptTeamInviteResult {
  ok: true;
  businessId: string;
  /** Seat role after accept: `admin` or `rider` (legacy invite `staff` normalizes to `rider`). */
  role: TeamSeatRole;
}

export interface AcceptTeamInviteError {
  ok: false;
  message: string;
  status: number;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findTeamInviteByToken(token: string): Promise<{
  businessId: string;
  inviteId: string;
  data: Record<string, unknown>;
} | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;

  const snap = await db
    .collectionGroup("team_invites")
    .where("token", "==", trimmed)
    .limit(1)
    .get();
  if (snap.empty) return null;

  const doc = snap.docs[0];
  const businessRef = doc.ref.parent.parent;
  if (!businessRef) return null;

  return {
    businessId: businessRef.id,
    inviteId: doc.id,
    data: doc.data(),
  };
}

export async function getTeamInvitePreview(
  token: string,
): Promise<TeamInvitePreview | null> {
  const found = await findTeamInviteByToken(token);
  if (!found) return null;

  const { businessId, data } = found;
  const rawStatus = String((data.status as string) || "pending");

  const businessSnap = await db.collection("businesses").doc(businessId).get();
  const businessName =
    (businessSnap.data()?.name as string) || "Smart Refill Station";

  if (rawStatus === "accepted") {
    return null;
  }

  if (rawStatus === "declined") {
    return {
      businessId,
      businessName,
      inviteeEmail: (data.inviteeEmail as string) || "",
      inviteeName: (data.inviteeName as string | null) || null,
      role: normalizeSeatRole(data.role),
      status: "declined",
      expired: false,
    };
  }

  const rawExpiry = data.expiresAt as
    | { toDate?: () => Date }
    | Date
    | undefined;
  const expiresAt =
    rawExpiry &&
    typeof (rawExpiry as { toDate?: () => Date }).toDate === "function" ?
      (rawExpiry as { toDate: () => Date }).toDate() :
      rawExpiry instanceof Date ?
        rawExpiry :
        undefined;
  const expired = Boolean(expiresAt && expiresAt.getTime() <= Date.now());

  return {
    businessId,
    businessName,
    inviteeEmail: (data.inviteeEmail as string) || "",
    inviteeName: (data.inviteeName as string | null) || null,
    role: normalizeSeatRole(data.role),
    status: rawStatus === "pending" ? "pending" : rawStatus,
    expired,
  };
}

export async function declineTeamInvite(input: {
  token: string;
  uid: string;
  email: string;
}): Promise<{ ok: true } | { ok: false; message: string; status: number }> {
  const found = await findTeamInviteByToken(input.token);
  if (!found) {
    return { ok: false, message: "Invitation not found.", status: 404 };
  }

  const { businessId, inviteId, data } = found;
  const inviteEmail = normalizeEmail((data.inviteeEmail as string) || "");
  const userEmail = normalizeEmail(input.email || "");
  if (!inviteEmail || userEmail !== inviteEmail) {
    return {
      ok: false,
      message:
        "Sign in with the same email address that received this invitation.",
      status: 403,
    };
  }

  const rawStatus = String((data.status as string) || "pending");
  if (rawStatus === "accepted") {
    return {
      ok: false,
      message: "This invitation was already accepted.",
      status: 400,
    };
  }
  if (rawStatus === "declined") {
    return {
      ok: false,
      message: "This invitation has already been declined.",
      status: 400,
    };
  }
  if (rawStatus !== "pending") {
    return {
      ok: false,
      message: "This invitation cannot be declined.",
      status: 400,
    };
  }

  const rawExpiryDecline = data.expiresAt as
    | { toDate?: () => Date }
    | Date
    | undefined;
  const expiresAtDecline =
    rawExpiryDecline &&
    typeof (rawExpiryDecline as { toDate?: () => Date }).toDate === "function" ?
      (rawExpiryDecline as { toDate: () => Date }).toDate() :
      rawExpiryDecline instanceof Date ?
        rawExpiryDecline :
        undefined;
  if (expiresAtDecline && expiresAtDecline.getTime() <= Date.now()) {
    return {
      ok: false,
      message: "This invitation already expired.",
      status: 400,
    };
  }

  await db
    .collection("businesses")
    .doc(businessId)
    .collection("team_invites")
    .doc(inviteId)
    .update({
      status: "declined",
      declinedByUid: input.uid,
      declinedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

  logger.info("Team invite declined", { businessId, inviteId });
  return { ok: true };
}

export async function acceptTeamInvite(
  input: AcceptTeamInviteInput,
): Promise<AcceptTeamInviteResult | AcceptTeamInviteError> {
  const found = await findTeamInviteByToken(input.token);
  if (!found) {
    return {
      ok: false,
      message: "This invitation is invalid or has expired.",
      status: 404,
    };
  }

  const { businessId, inviteId, data } = found;
  const inviteEmail = normalizeEmail((data.inviteeEmail as string) || "");
  const userEmail = normalizeEmail(input.email);

  if (!inviteEmail || userEmail !== inviteEmail) {
    return {
      ok: false,
      message:
        "Sign in with the same email address that received this invitation.",
      status: 403,
    };
  }

  const rawStatusAccept = String((data.status as string) || "pending");

  if (rawStatusAccept === "declined") {
    return {
      ok: false,
      message:
        "You declined this invitation. Ask the station owner if you changed your mind.",
      status: 400,
    };
  }

  if (rawStatusAccept !== "pending") {
    return {
      ok: false,
      message: "This invitation has already been used.",
      status: 400,
    };
  }

  const rawExpiryAccept = data.expiresAt as
    | { toDate?: () => Date }
    | Date
    | undefined;
  const expiresAtAccept =
    rawExpiryAccept &&
    typeof (rawExpiryAccept as { toDate?: () => Date }).toDate === "function" ?
      (rawExpiryAccept as { toDate: () => Date }).toDate() :
      rawExpiryAccept instanceof Date ?
        rawExpiryAccept :
        undefined;
  if (expiresAtAccept && expiresAtAccept.getTime() < Date.now()) {
    return {
      ok: false,
      message: "This invitation has expired. Ask for a new invite.",
      status: 400,
    };
  }

  const seatRole = normalizeSeatRole(data.role);
  const memberRole: TeamSeatRole = seatRole;
  const businessRef = db.collection("businesses").doc(businessId);
  const memberRef = businessRef.collection("members").doc(input.uid);

  const existingMember = await memberRef.get();
  if (existingMember.exists) {
    return {
      ok: false,
      message: "You are already a member of this workspace.",
      status: 400,
    };
  }

  const userProbeRef = db.collection("users").doc(input.uid);
  const userProbeSnap = await userProbeRef.get();
  const probeData = userProbeSnap.exists ? userProbeSnap.data() : undefined;
  const probeAccess = Array.isArray(probeData?.appAccess) ?
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    probeData!.appAccess :
    [];
  const otherStation = probeAccess.find(
    (a: { appId?: string; businessId?: string }) => a?.appId === "smartrefill",
  ) as { appId?: string; businessId?: string } | undefined;
  if (
    otherStation?.businessId &&
    String(otherStation.businessId) !== businessId
  ) {
    return {
      ok: false,
      message:
        "This sign-in already belongs to another Smart Refill station (owner or staff). " +
        "Use a different email or Google account, or exit the other workspace first.",
      status: 409,
    };
  }

  const name =
    input.displayName?.trim() ||
    (data.inviteeName as string)?.trim() ||
    userEmail.split("@")[0] ||
    "Team member";

  const batch = db.batch();

  batch.set(memberRef, {
    userId: input.uid,
    email: userEmail,
    name,
    displayName: name,
    role: memberRole,
    isActive: true,
    joinedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  batch.update(businessRef.collection("team_invites").doc(inviteId), {
    status: "accepted",
    acceptedByUid: input.uid,
    acceptedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const userRef = userProbeRef;
  const userData = probeData;
  const appAccess = mergeGrantedSmartrefillAppAccess(userData?.appAccess, {
    businessId,
    role: "staff",
    onboardingComplete: false,
  });

  batch.set(
    userRef,
    {
      uid: input.uid,
      email: userEmail,
      displayName: name,
      onboardingComplete: false,
      appAccess,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await batch.commit();

  if (memberRole === "rider") {
    try {
      const ridersSnap = await businessRef
        .collection("riders")
        .where("userId", "==", input.uid)
        .limit(1)
        .get();

      if (ridersSnap.empty) {
        await RiderService.addRider(businessId, {
          userId: input.uid,
          name,
          phone: "",
          status: "active",
          vehicle: "Fleet rider",
        });
      }
    } catch (err) {
      logger.warn("Rider profile link failed after invite accept", {
        businessId,
        uid: input.uid,
        err,
      });
    }
  }

  logger.info("Team invite accepted", {
    businessId,
    uid: input.uid,
    seatRole,
    memberRole,
  });
  return { ok: true, businessId, role: seatRole };
}

export async function completeStaffOnboarding(
  uid: string,
  businessId: string,
): Promise<void> {
  const memberRef = db
    .collection("businesses")
    .doc(businessId)
    .collection("members")
    .doc(uid);
  await memberRef.set(
    {
      onboarding: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return;

  const userData = userSnap.data();
  const appAccess = (userData?.appAccess || []).map(
    (a: Record<string, unknown>) => {
      if (a.appId !== "smartrefill") return a;
      const next: Record<string, unknown> = { ...a, onboardingComplete: true };
      delete next.staffOnboardingComplete;
      return next;
    },
  );

  await userRef.update({
    appAccess,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
