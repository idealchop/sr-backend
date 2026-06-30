import { randomBytes } from "crypto";
import { logger } from "../observability/logging/logger";
import { db, FieldValue, Timestamp } from "../../config/firebase-admin";
import { brevo, getBrevoApi } from "../../utils/brevo";
import { getTeamWorkspaceInviteEmail } from "../../utils/email-templates";
import { resolveAppBaseUrlForEmail } from "../../utils/app-base-url";
import {
  parsePlanLimitations,
  type ParsedPlanQuotas,
} from "../../utils/subscription-addon-plan-limits";
import {
  applyAddonBoostsToQuotas,
  emptyAddonLimitBoosts,
  type AddonLimitBoosts,
} from "../../utils/subscription-addon-limit-boosts";
import { SubscriptionService } from "../subscriptions/subscription-service";
import { RiderService } from "../riders/rider-service";
import { purgeRemovedMemberWorkspaceData } from "./team-member-removal-cleanup";
import { normalizeSeatRole, type TeamSeatRole } from "./team-seat-roles";
import {
  countActiveStaffSeatsForBusiness,
  TEAM_DIRECTORY_RECORDS,
} from "./staff-seat-usage";

export type TeamMemberRole = "owner" | "admin" | "staff" | "rider" | string;

export interface TeamMemberDto {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: TeamMemberRole;
  isActive: boolean;
  /** When inactive, whether the owner can reactivate without exceeding seat caps. */
  canActivate?: boolean;
  activationBlockReason?: string | null;
}

export interface AssignableRoleDto {
  value: TeamSeatRole;
  label: string;
}

/** Days until a workspace invitation link expires. */
export const TEAM_INVITE_EXPIRY_DAYS = 7;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function resolveEffectiveSeatQuotasForPlan(
  planCode: string,
  addonBoosts?: AddonLimitBoosts,
): Promise<ParsedPlanQuotas | null> {
  const planResolved = await SubscriptionService.lookupPlanRowForCode(planCode);
  const base = parsePlanLimitations(planResolved?.planData?.limitations);
  return applyAddonBoostsToQuotas(
    base,
    addonBoosts ?? emptyAddonLimitBoosts(),
  );
}

function readAddonBoostsFromLimitations(
  limitations: unknown,
): AddonLimitBoosts | undefined {
  if (!limitations || typeof limitations !== "object") return undefined;
  const boosts = (limitations as { addonBoosts?: AddonLimitBoosts }).addonBoosts;
  if (!boosts || typeof boosts !== "object") return undefined;
  return boosts;
}

function assignableRolesForPlan(planCode: string): AssignableRoleDto[] {
  const code = (planCode || "starter").toLowerCase();
  // Match subscription catalog / plan-entitlements: Scale+ get admin invites; Grow uses code "grow"
  // in Firestore (legacy checkouts may still persist "pro").
  if (code.includes("enterprise")) {
    return [
      { value: "admin", label: "Admin" },
      { value: "rider", label: "Rider / Operator" },
    ];
  }
  if (code.includes("scale")) {
    return [
      { value: "admin", label: "Admin" },
      { value: "rider", label: "Rider / Operator" },
    ];
  }
  if (code === "pro" || code === "grow" || code.includes("grow")) {
    return [{ value: "rider", label: "Rider / Operator" }];
  }
  return [];
}

function memberDocIsActive(d: Record<string, unknown>): boolean {
  return d.isActive !== false;
}

// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
/**
 * Active seats only (inactive members free a slot). Owner excluded from role buckets.
 */
function countOccupiedMemberSeatsByRole(members: TeamMemberDto[]): {
  admins: number;
  riders: number;
} {
  let admins = 0;
  let riders = 0;
  for (const m of members) {
    if (!m.isActive) continue;
    const r = String(m.role || "rider").toLowerCase();
    if (r === "owner") continue;
    if (r === "admin") admins++;
    else riders++;
  }
  return { admins, riders };
}

function countSeatRolesFromMemberDocs(
  docs: Array<{ data: () => Record<string, unknown> }>,
  options?: { activeOnly?: boolean },
): { admins: number; riders: number } {
  let admins = 0;
  let riders = 0;
  for (const doc of docs) {
    const d = doc.data();
    if (options?.activeOnly && !memberDocIsActive(d)) continue;
    const r = String(d.role || "rider").toLowerCase();
    if (r === "owner") continue;
    if (r === "admin") admins++;
    else riders++;
  }
  return { admins, riders };
}

function countActiveStaffMembers(members: TeamMemberDto[]): number {
  return members.filter((m) => {
    if (!m.isActive) return false;
    return String(m.role || "").toLowerCase() !== "owner";
  }).length;
}

async function evaluateMemberActivationEligibility(
  businessId: string,
  memberRole: TeamSeatRole,
): Promise<{ canActivate: boolean; reason: string | null }> {
  const sub = await SubscriptionService.getSubscriptionStatus(businessId);
  const planCode = (sub.planCode || "starter").toLowerCase();
  const limitations =
    "limitations" in sub && sub.limitations ?
      sub.limitations :
      { staffLimit: 1, currentStaffCount: 0 };

  const [pending, seatUsage] = await Promise.all([
    countPendingInvitesByRole(businessId),
    countActiveStaffSeatsForBusiness(businessId),
  ]);
  const activeTotal = seatUsage.total;
  const pendingTotalActive = pending.admins + pending.riders;

  const limit = limitations.staffLimit;
  if (limit > 0 && activeTotal + pendingTotalActive >= limit) {
    return {
      canActivate: false,
      reason: `Your plan allows ${limit} active staff seats (including pending invites).`,
    };
  }

  const quotas = await resolveEffectiveSeatQuotasForPlan(
    planCode,
    readAddonBoostsFromLimitations(limitations),
  );
  const adminsUsed = seatUsage.admins + pending.admins;
  const ridersUsed = seatUsage.riders + pending.riders;

  const allowedFiltered = filterAssignableRolesBySeatQuotas(
    assignableRolesForPlan(planCode),
    quotas,
    adminsUsed,
    ridersUsed,
  );

  if (!allowedFiltered.some((r) => r.value === memberRole)) {
    if (!assignableRolesForPlan(planCode).some((r) => r.value === memberRole)) {
      return {
        canActivate: false,
        reason: "This role is not available on your current plan.",
      };
    }
    const capMsg =
      memberRole === "admin" ?
        "All admin seats are in use. Deactivate another admin or upgrade your plan." :
        "All rider seats are in use. Deactivate another rider or upgrade your plan.";
    return { canActivate: false, reason: capMsg };
  }

  return { canActivate: true, reason: null };
}

// eslint-disable-next-line valid-jsdoc
/** Non-expired pending invites count toward quota for the invitee role. */
async function countPendingInvitesByRole(
  businessId: string,
): Promise<{ admins: number; riders: number }> {
  const snap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("team_invites")
    .where("status", "==", "pending")
    .get();

  const now = Date.now();
  let admins = 0;
  let riders = 0;
  for (const doc of snap.docs) {
    const x = doc.data();
    const exp = x.expiresAt?.toDate?.() as Date | undefined;
    if (exp && exp.getTime() <= now) continue;
    const seat = normalizeSeatRole(x.role);
    if (seat === "admin") admins++;
    else riders++;
  }

  return { admins, riders };
}

// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
/**
 * Drops admin or rider invite options when the plan's seat caps are exhausted.
 * When quotas are absent (legacy plans), tiers still apply via assignableRolesForPlan alone.
 */
export function filterAssignableRolesBySeatQuotas(
  roles: AssignableRoleDto[],
  quotas: ParsedPlanQuotas | null,
  adminsUsedIncludingPending: number,
  ridersUsedIncludingPending: number,
): AssignableRoleDto[] {
  if (!quotas) return roles;

  let next = [...roles];

  if (
    quotaIsFiniteNumber(quotas.staffAdminMax) &&
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    adminsUsedIncludingPending >= quotas.staffAdminMax!
  ) {
    next = next.filter((r) => r.value !== "admin");
  }

  if (
    quotaIsFiniteNumber(quotas.staffRiderMax) &&
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    ridersUsedIncludingPending >= quotas.staffRiderMax!
  ) {
    next = next.filter((r) => r.value !== "rider");
  }

  return next;
}

function quotaIsFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

function assertTeamHubEligible(sub: {
  status: string;
  planCode?: string;
  billingCycle?: string;
}): string | null {
  const plan = (sub.planCode || "starter").toLowerCase();
  const cycle = (sub.billingCycle || "").toLowerCase();
  if (plan === "starter" || plan === "free") {
    return "Team invitations are not available on the Starter plan.";
  }
  if (cycle === "trial" || sub.status === "trial") {
    return "Team invitations are not available during the trial period.";
  }
  if (sub.status !== "active" && sub.status !== "grace_period") {
    return "Team invitations require an active subscription.";
  }
  return null;
}

/**
 * Lists workspace members and invite metadata for Team Hub.
 * @param {string} businessId Business id.
 * @return {Promise<TeamMemberDto[]>} Member rows for display.
 */
export async function listTeamMembers(
  businessId: string,
): Promise<TeamMemberDto[]> {
  const snap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("members")
    .get();
  return snap.docs.map((doc) => {
    const d = doc.data();
    const isActive = d.isActive !== false;
    return {
      id: doc.id,
      userId: d.userId || doc.id,
      name: (d.name || d.displayName || "Member") as string,
      email: (d.email || "") as string,
      role: (d.role || "rider") as TeamMemberRole,
      isActive,
    };
  });
}

/** Invite row surfaced in Team Hub (pending/expired/deferred lists). */
export interface TeamHubPendingInviteDto {
  id: string;
  inviteeEmail: string;
  inviteeName: string | null;
  role: TeamSeatRole;
  /** RFC3339 timestamp when the invitation link lapses */
  expiresAt: string | null;
  expired: boolean;
  /** Derived status for badges and bulk actions */
  displayStatus: "invited" | "expired" | "declined";
}

/**
 * Lists outstanding workspace invitations (active, lapsed-but-pending, and declined).
 * @param {string} businessId Business id.
 * @return {Promise<TeamHubPendingInviteDto[]>} Rows, newest activity first.
 */
export async function listPendingTeamInvitesForHub(
  businessId: string,
): Promise<TeamHubPendingInviteDto[]> {
  const ref = db
    .collection("businesses")
    .doc(businessId)
    .collection("team_invites");
  const [pendingSnap, declinedSnap] = await Promise.all([
    ref.where("status", "==", "pending").get(),
    ref.where("status", "==", "declined").get(),
  ]);

  const now = Date.now();
  type RowInternal = TeamHubPendingInviteDto & { _created: number };
  const rowsInternal: RowInternal[] = [];

  for (const doc of pendingSnap.docs) {
    const d = doc.data();
    const created = d.createdAt?.toDate?.() as Date | undefined;
    const exp = d.expiresAt?.toDate?.() as Date | undefined;
    const expired = Boolean(exp && exp.getTime() <= now);
    rowsInternal.push({
      id: doc.id,
      inviteeEmail: String(d.inviteeEmail || "").trim(),
      inviteeName: d.inviteeName ? String(d.inviteeName).trim() : null,
      role: normalizeSeatRole(d.role),
      expiresAt: exp ? exp.toISOString() : null,
      expired,
      displayStatus: expired ? "expired" : "invited",
      _created: created ? created.getTime() : 0,
    });
  }

  for (const doc of declinedSnap.docs) {
    const d = doc.data();
    const updated =
      (d.updatedAt?.toDate?.() as Date | undefined) ||
      (d.declinedAt?.toDate?.() as Date | undefined) ||
      (d.createdAt?.toDate?.() as Date | undefined);
    rowsInternal.push({
      id: doc.id,
      inviteeEmail: String(d.inviteeEmail || "").trim(),
      inviteeName: d.inviteeName ? String(d.inviteeName).trim() : null,
      role: normalizeSeatRole(d.role),
      expiresAt: null,
      expired: false,
      displayStatus: "declined",
      _created: updated ? updated.getTime() : 0,
    });
  }

  rowsInternal.sort((a, b) => b._created - a._created);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return rowsInternal.map(({ _created: __, ...row }) => row);
}

/** Directory entry without workspace login — for personnel records only. */
export interface TeamHubRecordRiderDto {
  id: string;
  name: string;
  phone: string;
  photoUrl?: string | null;
  role: TeamSeatRole;
  status: "active" | "inactive";
}

function isRecordOnlyRiderUserId(userId: unknown): boolean {
  return !userId || !String(userId).trim();
}

function mapDirectoryRecordDoc(
  id: string,
  data: Record<string, unknown>,
): TeamHubRecordRiderDto {
  return {
    id,
    name: String(data.name || "Member").trim(),
    phone: String(data.phone || "").trim(),
    photoUrl: data.photoUrl ? String(data.photoUrl).trim() : null,
    role: normalizeSeatRole(data.role),
    status: data.status === "inactive" ? "inactive" : "active",
  };
}

/**
 * Lists personnel with no linked login (directory-only records).
 * @param {string} businessId Business id.
 * @return {Promise<TeamHubRecordRiderDto[]>} Record-only directory rows.
 */
export async function listRecordOnlyRidersForHub(
  businessId: string,
): Promise<TeamHubRecordRiderDto[]> {
  const businessRef = db.collection("businesses").doc(businessId);
  const [riders, directorySnap] = await Promise.all([
    RiderService.getRidersByBusiness(businessId),
    businessRef.collection(TEAM_DIRECTORY_RECORDS).get(),
  ]);

  const riderRows = riders
    .filter((r) => r.id && isRecordOnlyRiderUserId(r.userId))
    .map((r) => ({
      id: r.id as string,
      name: (r.name || "Rider").trim(),
      phone: (r.phone || "").trim(),
      photoUrl: r.photoUrl?.trim() || null,
      role: "rider" as TeamSeatRole,
      status: (r.status === "inactive" ? "inactive" : "active") as
        | "active"
        | "inactive",
    }));

  const directoryRows = directorySnap.docs.map((doc) =>
    mapDirectoryRecordDoc(doc.id, doc.data()),
  );

  return [...riderRows, ...directoryRows].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

export interface TeamHubOverview {
  members: TeamMemberDto[];
  /** Outstanding invitations (shown in directory with Invited / Expired status). */
  pendingInvites: TeamHubPendingInviteDto[];
  /** Riders without linked Firebase Auth — directory-only records. */
  recordOnlyRiders: TeamHubRecordRiderDto[];
  assignableRoles: AssignableRoleDto[];
  staffLimit: number;
  currentStaffCount: number;
}

export async function getTeamHubOverview(
  businessId: string,
): Promise<TeamHubOverview> {
  const sub = await SubscriptionService.getSubscriptionStatus(businessId);
  const [rawMembers, pendingInvites, recordOnlyRiders] = await Promise.all([
    listTeamMembers(businessId),
    listPendingTeamInvitesForHub(businessId),
    listRecordOnlyRidersForHub(businessId),
  ]);
  const planCode = (sub.planCode || "starter").toLowerCase();
  const limitations =
    "limitations" in sub && sub.limitations ?
      sub.limitations :
      { staffLimit: 1, currentStaffCount: countActiveStaffMembers(rawMembers) };

  const members = await Promise.all(
    rawMembers.map(async (m) => {
      if (m.isActive || String(m.role || "").toLowerCase() === "owner") {
        return m;
      }
      const seatRole = normalizeSeatRole(m.role);
      const eligibility = await evaluateMemberActivationEligibility(
        businessId,
        seatRole,
      );
      return {
        ...m,
        canActivate: eligibility.canActivate,
        activationBlockReason: eligibility.reason,
      };
    }),
  );

  let assignableRoles = assignableRolesForPlan(planCode);
  try {
    const quotas = await resolveEffectiveSeatQuotasForPlan(
      planCode,
      readAddonBoostsFromLimitations(limitations),
    );
    const pending = await countPendingInvitesByRole(businessId);
    const seatUsage = await countActiveStaffSeatsForBusiness(businessId);
    assignableRoles = filterAssignableRolesBySeatQuotas(
      assignableRoles,
      quotas,
      seatUsage.admins + pending.admins,
      seatUsage.riders + pending.riders,
    );
  } catch (e) {
    logger.warn("getTeamHubOverview: seat quota filter skipped", {
      businessId,
      planCode,
      error: String(e),
    });
  }

  return {
    members,
    pendingInvites,
    recordOnlyRiders,
    assignableRoles,
    staffLimit: limitations.staffLimit,
    currentStaffCount: limitations.currentStaffCount,
  };
}

/**
 * Creates a record-only rider profile (no workspace invite or login).
 * @param {Object} params Input payload.
 * @return {Promise<Object>} Created rider row or error.
 */
export async function createRecordOnlyRiderForHub(params: {
  businessId: string;
  name: string;
  role: TeamSeatRole;
  phone?: string;
  photoUrl?: string;
}): Promise<
  | { ok: true; rider: TeamHubRecordRiderDto }
  | { ok: false; message: string; status: number }
> {
  const name = params.name.trim();
  if (!name) {
    return { ok: false, message: "Name is required.", status: 400 };
  }

  const role = normalizeSeatRole(params.role);
  const phone = typeof params.phone === "string" ? params.phone.trim() : "";
  const photoUrl =
    typeof params.photoUrl === "string" ? params.photoUrl.trim() : "";

  const eligibility = await evaluateMemberActivationEligibility(
    params.businessId,
    role,
  );
  if (!eligibility.canActivate) {
    return {
      ok: false,
      message: eligibility.reason || "Staff seat limit reached.",
      status: 400,
    };
  }

  try {
    if (role === "rider") {
      const created = await RiderService.addRider(params.businessId, {
        name,
        phone,
        userId: "",
        status: "active",
        ...(photoUrl ? { photoUrl } : {}),
      });

      if (!created.id) {
        return {
          ok: false,
          message: "Could not save the directory record.",
          status: 500,
        };
      }

      return {
        ok: true,
        rider: {
          id: created.id,
          name,
          phone,
          photoUrl: photoUrl || null,
          role,
          status: "active",
        },
      };
    }

    const businessRef = db.collection("businesses").doc(params.businessId);
    const payload = {
      name,
      phone,
      role,
      status: "active",
      ...(photoUrl ? { photoUrl } : {}),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    const docRef = await businessRef
      .collection(TEAM_DIRECTORY_RECORDS)
      .add(payload);

    return {
      ok: true,
      rider: {
        id: docRef.id,
        name,
        phone,
        photoUrl: photoUrl || null,
        role,
        status: "active",
      },
    };
  } catch (e) {
    logger.error("createRecordOnlyRiderForHub failed", e);
    return {
      ok: false,
      message: "Could not save the directory record.",
      status: 500,
    };
  }
}

/**
 * Removes a record-only rider profile from the directory.
 * @param {Object} params Business and rider ids.
 * @return {Promise<Object>} Success or error.
 */
export async function deleteRecordOnlyRiderFromHub(params: {
  businessId: string;
  riderId: string;
}): Promise<{ ok: true } | { ok: false; message: string; status: number }> {
  const rider = await RiderService.getRider(params.businessId, params.riderId);
  if (rider) {
    if (!isRecordOnlyRiderUserId(rider.userId)) {
      return {
        ok: false,
        message:
          "This person has login access. Remove them from workspace members instead.",
        status: 400,
      };
    }
    try {
      await RiderService.deleteRider(params.businessId, params.riderId);
      return { ok: true };
    } catch (e) {
      logger.error("deleteRecordOnlyRiderFromHub rider failed", e);
      return {
        ok: false,
        message: "Could not remove this record.",
        status: 500,
      };
    }
  }

  const directoryRef = db
    .collection("businesses")
    .doc(params.businessId)
    .collection(TEAM_DIRECTORY_RECORDS)
    .doc(params.riderId);
  const directorySnap = await directoryRef.get();
  if (!directorySnap.exists) {
    return { ok: false, message: "Record not found.", status: 404 };
  }

  try {
    await directoryRef.delete();
    return { ok: true };
  } catch (e) {
    logger.error("deleteRecordOnlyRiderFromHub directory failed", e);
    return {
      ok: false,
      message: "Could not remove this record.",
      status: 500,
    };
  }
}

export async function setTeamMemberActiveStatus(params: {
  businessId: string;
  memberId: string;
  isActive: boolean;
  actorUid: string;
}): Promise<{ ok: true } | { ok: false; message: string; status: number }> {
  const { businessId, memberId, isActive } = params;

  const businessRef = db.collection("businesses").doc(businessId);
  const businessSnap = await businessRef.get();
  if (!businessSnap.exists) {
    return { ok: false, message: "Workspace not found.", status: 404 };
  }

  if (businessSnap.data()?.ownerId === memberId) {
    return {
      ok: false,
      message: "The workspace owner cannot be deactivated.",
      status: 400,
    };
  }

  const memberRef = businessRef.collection("members").doc(memberId);
  const memberSnap = await memberRef.get();
  if (!memberSnap.exists) {
    return { ok: false, message: "Member not found.", status: 404 };
  }

  const memberData = memberSnap.data() || {};
  const seatRole = normalizeSeatRole(memberData.role);
  const currentlyActive = memberData.isActive !== false;

  if (!isActive) {
    if (!currentlyActive) {
      return { ok: true };
    }
    await memberRef.update({
      isActive: false,
      deactivatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    logger.info("Team member deactivated", {
      businessId,
      memberId,
      byUid: params.actorUid,
    });
    return { ok: true };
  }

  if (currentlyActive) {
    return { ok: true };
  }

  const eligibility = await evaluateMemberActivationEligibility(
    businessId,
    seatRole,
  );
  if (!eligibility.canActivate) {
    return {
      ok: false,
      message: eligibility.reason || "Cannot activate this member right now.",
      status: 400,
    };
  }

  await memberRef.update({
    isActive: true,
    deactivatedAt: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  logger.info("Team member reactivated", {
    businessId,
    memberId,
    byUid: params.actorUid,
  });
  return { ok: true };
}

export async function removeTeamMember(params: {
  businessId: string;
  memberId: string;
  actorUid: string;
}): Promise<{ ok: true } | { ok: false; message: string; status: number }> {
  const { businessId, memberId } = params;

  const businessRef = db.collection("businesses").doc(businessId);
  const businessSnap = await businessRef.get();
  if (!businessSnap.exists) {
    return { ok: false, message: "Workspace not found.", status: 404 };
  }

  if (businessSnap.data()?.ownerId === memberId) {
    return {
      ok: false,
      message: "The workspace owner cannot be removed.",
      status: 400,
    };
  }

  const memberRef = businessRef.collection("members").doc(memberId);
  const memberSnap = await memberRef.get();
  if (!memberSnap.exists) {
    return { ok: false, message: "Member not found.", status: 404 };
  }

  const memberData = memberSnap.data() || {};
  const userId = String(memberData.userId || memberId);
  const memberEmail = String(memberData.email || "");

  await memberRef.delete();

  try {
    await purgeRemovedMemberWorkspaceData({
      businessId,
      userId,
      memberEmail,
    });
  } catch (purgeErr) {
    logger.warn("Team member removed but workspace artifact purge failed", {
      businessId,
      memberId,
      userId,
      error: String(purgeErr),
    });
  }

  try {
    const { revokeUserSmartrefillWorkspaceAccess } = await import(
      "./workspace-member-access"
    );
    await revokeUserSmartrefillWorkspaceAccess(userId, businessId);
  } catch (revokeErr) {
    logger.warn("Team member removed but appAccess revoke failed", {
      businessId,
      memberId,
      userId,
      error: String(revokeErr),
    });
  }

  logger.info("Team member removed from workspace", {
    businessId,
    memberId,
    userId,
    byUid: params.actorUid,
  });

  return { ok: true };
}

export interface CreateTeamInviteInput {
  businessId: string;
  businessName: string;
  inviterUid: string;
  inviterName: string;
  inviterEmail: string;
  inviteeEmail: string;
  inviteeName?: string;
  role: TeamSeatRole;
  /** Dashboard origin from the inviting user's browser session. */
  appBaseUrl?: string;
}

export interface CreateTeamInviteResult {
  ok: true;
  inviteId: string;
}

export interface CreateTeamInviteError {
  ok: false;
  message: string;
  status: number;
}

async function transmitTeamWorkspaceInviteEmail(args: {
  inviteeEmail: string;
  inviteeDisplayName: string;
  organizationName: string;
  roleKey: TeamSeatRole;
  inviteUrl: string;
  inviterName: string;
  inviterEmail: string;
}): Promise<void> {
  if (process.env.FUNCTIONS_EMULATOR) {
    logger.info("EMULATOR: Skipping team invite email", {
      email: args.inviteeEmail,
      url: args.inviteUrl,
    });
    return;
  }

  const api = getBrevoApi();
  const tpl = getTeamWorkspaceInviteEmail({
    acceptInviteUrl: args.inviteUrl,
    inviterName: args.inviterName,
    inviteeDisplayName: args.inviteeDisplayName,
    inviteeEmail: args.inviteeEmail,
    organizationName: args.organizationName,
    roleKey: args.roleKey,
    validityDays: TEAM_INVITE_EXPIRY_DAYS,
  });
  const sendSmtpEmail = new brevo.SendSmtpEmail();
  sendSmtpEmail.sender = {
    name: "Smart Refill",
    email: "no-reply@smartrefill.io",
  };
  sendSmtpEmail.to = [
    { email: args.inviteeEmail, name: args.inviteeDisplayName },
  ];
  sendSmtpEmail.cc = [{ email: args.inviterEmail, name: args.inviterName }];
  sendSmtpEmail.subject = tpl.subject;
  sendSmtpEmail.htmlContent = tpl.html;
  sendSmtpEmail.textContent = tpl.text;
  sendSmtpEmail.tags = ["team_workspace_invite"];
  await api.sendTransacEmail(sendSmtpEmail);
  logger.info("Team invite email sent", { email: args.inviteeEmail });
}

// eslint-disable-next-line valid-jsdoc
/** Re-sends invitation email with a renewed token after expiry or decline. */
export async function resendTeamHubInvite(params: {
  businessId: string;
  inviteId: string;
  inviterUid: string;
  inviterName: string;
  inviterEmail: string;
  appBaseUrl?: string;
}): Promise<{ ok: true } | { ok: false; message: string; status: number }> {
  const sub = await SubscriptionService.getSubscriptionStatus(
    params.businessId,
  );
  const gate = assertTeamHubEligible(sub);
  if (gate) {
    return { ok: false, message: gate, status: 403 };
  }

  const businessRef = db.collection("businesses").doc(params.businessId);
  const businessSnap = await businessRef.get();
  const organizationName =
    (businessSnap.data()?.name as string) || "Smart Refill Station";

  const inviteRef = businessRef.collection("team_invites").doc(params.inviteId);
  const inviteSnap = await inviteRef.get();
  if (!inviteSnap.exists) {
    return { ok: false, message: "Invitation not found.", status: 404 };
  }

  const d = inviteSnap.data() || {};
  const st = String(d.status || "");
  if (st !== "pending" && st !== "declined") {
    return {
      ok: false,
      message: "Only open or declined invitations can be resent.",
      status: 400,
    };
  }

  const inviteeEmail = normalizeEmail(String(d.inviteeEmail || ""));
  const role = normalizeSeatRole(d.role);

  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + TEAM_INVITE_EXPIRY_DAYS);

  await inviteRef.update({
    token,
    expiresAt: Timestamp.fromDate(expiresAt),
    status: "pending",
    updatedAt: FieldValue.serverTimestamp(),
    declinedAt: FieldValue.delete(),
    declinedByUid: FieldValue.delete(),
  });

  const inviteBase = resolveAppBaseUrlForEmail(params.appBaseUrl);
  const url = `${inviteBase}/invite?token=${encodeURIComponent(token)}`;
  const inviteeLabel =
    String(d.inviteeName || "").trim() ||
    inviteeEmail.split("@")[0] ||
    "Teammate";

  try {
    await transmitTeamWorkspaceInviteEmail({
      inviteeEmail,
      inviteeDisplayName: inviteeLabel,
      organizationName,
      roleKey: role,
      inviteUrl: url,
      inviterName: params.inviterName,
      inviterEmail: params.inviterEmail,
    });
  } catch (err) {
    logger.error("resendTeamHubInvite email failed", err);
    return {
      ok: false,
      message: "Could not send the invitation email. Please try again later.",
      status: 502,
    };
  }

  logger.info("Team invite resent", {
    businessId: params.businessId,
    inviteId: params.inviteId,
    byUid: params.inviterUid,
  });
  return { ok: true };
}

// eslint-disable-next-line valid-jsdoc
/** Cancels pending invites or removes declined rows from the directory list. */
export async function deleteTeamHubInvite(params: {
  businessId: string;
  inviteId: string;
}): Promise<{ ok: true } | { ok: false; message: string; status: number }> {
  const ref = db
    .collection("businesses")
    .doc(params.businessId)
    .collection("team_invites")
    .doc(params.inviteId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, message: "Invitation not found.", status: 404 };
  }
  const d = snap.data() || {};
  const st = String(d.status || "");
  if (st === "declined" || st === "pending") {
    await ref.delete();
    return { ok: true };
  }
  return {
    ok: false,
    message: "Only open or declined invitations can be removed.",
    status: 400,
  };
}

/**
 * Creates a tenant-scoped invite and sends the Brevo template email (legacy parity).
 * @param {CreateTeamInviteInput} input Invite payload.
 * @return {Promise<CreateTeamInviteResult|CreateTeamInviteError>} Outcome.
 */
export async function createTeamInvite(
  input: CreateTeamInviteInput,
): Promise<CreateTeamInviteResult | CreateTeamInviteError> {
  const email = normalizeEmail(input.inviteeEmail);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      ok: false,
      message: "A valid invitee email is required.",
      status: 400,
    };
  }

  const sub = await SubscriptionService.getSubscriptionStatus(input.businessId);
  const gate = assertTeamHubEligible(sub);
  if (gate) {
    return { ok: false, message: gate, status: 403 };
  }

  const planCode = (sub.planCode || "starter").toLowerCase();

  const businessRef = db.collection("businesses").doc(input.businessId);
  const membersSnap = await businessRef.collection("members").get();
  const duplicateMember = membersSnap.docs.some(
    (d) => normalizeEmail((d.data().email as string) || "") === email,
  );
  if (duplicateMember) {
    return {
      ok: false,
      message: "That email already belongs to a workspace member.",
      status: 400,
    };
  }

  const limitations =
    "limitations" in sub && sub.limitations ?
      sub.limitations :
      { staffLimit: 1, currentStaffCount: membersSnap.size };
  const current = limitations.currentStaffCount;
  const limit = limitations.staffLimit;

  const quotas = await resolveEffectiveSeatQuotasForPlan(
    planCode,
    readAddonBoostsFromLimitations(limitations),
  );
  const pendingByRole = await countPendingInvitesByRole(input.businessId);
  const pendingTotalActive = pendingByRole.admins + pendingByRole.riders;
  if (limit > 0 && current + pendingTotalActive >= limit) {
    return {
      ok: false,
      message: `You have reached your plan limit of ${limit} staff seats (includes pending
        invitations).`,
      status: 400,
    };
  }

  const seatCounts = countSeatRolesFromMemberDocs(membersSnap.docs, {
    activeOnly: true,
  });
  const adminsUsed = seatCounts.admins + pendingByRole.admins;
  const ridersUsed = seatCounts.riders + pendingByRole.riders;

  const allowedFiltered = filterAssignableRolesBySeatQuotas(
    assignableRolesForPlan(planCode),
    quotas,
    adminsUsed,
    ridersUsed,
  );
  if (!allowedFiltered.some((r) => r.value === input.role)) {
    if (!assignableRolesForPlan(planCode).some((r) => r.value === input.role)) {
      return {
        ok: false,
        message: "This role is not available on your current plan.",
        status: 400,
      };
    }
    const capMsg =
      input.role === "admin" ?
        "All admin seats on your subscription are filled. " +
        "Invite riders only, or upgrade your plan." :
        "All rider seats on your subscription are filled.";
    return { ok: false, message: capMsg, status: 400 };
  }

  const existingInvites = await businessRef
    .collection("team_invites")
    .where("inviteeEmail", "==", email)
    .limit(10)
    .get();
  const now = Date.now();
  const hasPending = existingInvites.docs.some((d) => {
    const x = d.data();
    if (x.status !== "pending") return false;
    const exp = x.expiresAt?.toDate?.() as Date | undefined;
    return !exp || exp.getTime() > now;
  });
  if (hasPending) {
    return {
      ok: false,
      message: "An invitation is already pending for that email.",
      status: 400,
    };
  }

  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + TEAM_INVITE_EXPIRY_DAYS);

  const inviteRef = businessRef.collection("team_invites").doc();
  const invitePayload = {
    token,
    inviteeEmail: email,
    inviteeName: (input.inviteeName || "").trim() || null,
    role: input.role,
    status: "pending" as const,
    createdByUid: input.inviterUid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromDate(expiresAt),
  };

  await inviteRef.set(invitePayload);

  const inviteBase = resolveAppBaseUrlForEmail(input.appBaseUrl);
  const encoded = encodeURIComponent(token);
  const url = `${inviteBase}/invite?token=${encoded}`;

  const inviteeLabel =
    (input.inviteeName || "").trim() || email.split("@")[0] || "Teammate";

  try {
    await transmitTeamWorkspaceInviteEmail({
      inviteeEmail: email,
      inviteeDisplayName: inviteeLabel,
      organizationName: input.businessName,
      roleKey: input.role,
      inviteUrl: url,
      inviterName: input.inviterName,
      inviterEmail: input.inviterEmail,
    });
  } catch (err) {
    logger.error("Team invite email failed; rolling back invite doc", err);
    await inviteRef.delete();
    return {
      ok: false,
      message: "Could not send the invitation email. Please try again later.",
      status: 502,
    };
  }

  return { ok: true, inviteId: inviteRef.id };
}
