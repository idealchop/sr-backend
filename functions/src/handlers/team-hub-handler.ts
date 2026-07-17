import { Request, Response } from "express";
import { db } from "../config/firebase-admin";
import {
  logAuditEvent,
  logger,
} from "../services/observability/logging/logger";
import {
  createTeamInvite,
  createRecordOnlyRiderForHub,
  deleteRecordOnlyRiderFromHub,
  deleteTeamHubInvite,
  getTeamHubOverview,
  resendTeamHubInvite,
  removeTeamMember,
  setTeamMemberActiveStatus,
} from "../services/team/team-hub-service";
import { normalizeSeatRole } from "../services/team/team-seat-roles";
import { SubscriptionService } from "../services/subscriptions/subscription-service";
import { parseAppBaseUrlFromBody } from "../utils/app-base-url";

function assertTeamHubEligibleOrSend(
  res: Response,
  sub: Awaited<ReturnType<typeof SubscriptionService.getSubscriptionStatus>>,
): boolean {
  const plan = (sub.planCode || "starter").toLowerCase();
  if (plan === "starter" || plan === "free") {
    res
      .status(403)
      .json({ error: "Team Hub is not available on the Starter plan." });
    return false;
  }
  // Scale trial (billingCycle trial) includes Team Hub; seats deactivate on trial → Starter.
  if (sub.status !== "active" && sub.status !== "grace_period") {
    res
      .status(403)
      .json({ error: "Team Hub requires an active subscription." });
    return false;
  }
  return true;
}

/**
 * GET /business/:businessId/team — members, assignable roles, and staff limits.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const getTeamHub = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  if (!businessId) {
    res.status(400).json({ error: "businessId is required" });
    return;
  }
  try {
    const sub = await SubscriptionService.getSubscriptionStatus(businessId);
    if (!assertTeamHubEligibleOrSend(res, sub)) return;
    const overview = await getTeamHubOverview(businessId);
    res.json({ data: overview });
  } catch (e) {
    logger.error("getTeamHub failed", e);
    res.status(500).json({ error: "Failed to load team hub" });
  }
};

/**
 * POST /business/:businessId/team/invites — create and email an invitation.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const postTeamInvite = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (
    req as { user?: { uid: string; email?: string; name?: string } }
  ).user;
  if (!businessId || !user?.uid) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const { inviteeEmail, inviteeName, role } = req.body as {
    inviteeEmail?: string;
    inviteeName?: string;
    role?: string;
  };

  if (!inviteeEmail || typeof inviteeEmail !== "string") {
    res.status(400).json({ error: "inviteeEmail is required" });
    return;
  }
  const raw = String(role ?? "")
    .trim()
    .toLowerCase();
  if (raw !== "admin" && raw !== "rider" && raw !== "staff") {
    res.status(400).json({ error: "role must be \"admin\" or \"rider\"" });
    return;
  }

  const normalizedRole = normalizeSeatRole(role);
  try {
    const businessDoc = await db.collection("businesses").doc(businessId).get();
    const businessName =
      (businessDoc.data()?.name as string) || "Your workspace";

    const inviterName =
      (user as { name?: string }).name ||
      user.email?.split("@")[0] ||
      "Workspace owner";

    const result = await createTeamInvite({
      businessId,
      businessName,
      inviterUid: user.uid,
      inviterName,
      inviterEmail: user.email || "",
      inviteeEmail,
      inviteeName: typeof inviteeName === "string" ? inviteeName : undefined,
      role: normalizedRole,
      appBaseUrl: parseAppBaseUrlFromBody(req.body),
    });

    if (!result.ok) {
      res.status(result.status).json({ error: result.message });
      return;
    }

    await logAuditEvent(
      "TEAM_INVITE_CREATED",
      { businessId, userId: user.uid, inviteId: result.inviteId },
      null,
      { inviteeEmail, role: normalizedRole },
    );

    res.status(201).json({ success: true, inviteId: result.inviteId });
  } catch (e) {
    logger.error("postTeamInvite failed", e);
    res.status(500).json({ error: "Failed to create invitation" });
  }
};

/**
 * POST /business/:businessId/team/invites/:inviteId/resend — reissue link after lapse or decline.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const postResendTeamInvite = async (req: Request, res: Response) => {
  const { businessId, inviteId } = req.params;
  const user = (
    req as { user?: { uid: string; email?: string; name?: string } }
  ).user;
  if (!businessId || !inviteId || !user?.uid) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  try {
    const businessDoc = await db.collection("businesses").doc(businessId).get();
    if (!businessDoc.exists) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const inviterName =
      (user as { name?: string }).name ||
      user.email?.split("@")[0] ||
      "Workspace owner";

    const result = await resendTeamHubInvite({
      businessId,
      inviteId,
      inviterUid: user.uid,
      inviterName,
      inviterEmail: user.email || "",
      appBaseUrl: parseAppBaseUrlFromBody(req.body),
    });

    if (!result.ok) {
      res.status(result.status).json({ error: result.message });
      return;
    }

    await logAuditEvent(
      "TEAM_INVITE_RESENT",
      { businessId, userId: user.uid, inviteId },
      null,
      {},
    );
    res.status(200).json({ success: true });
  } catch (e) {
    logger.error("postResendTeamInvite failed", e);
    res.status(500).json({ error: "Failed to resend invitation" });
  }
};

/**
 * PATCH /business/:businessId/team/members/:memberId — activate or deactivate a member.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const patchTeamMemberStatus = async (req: Request, res: Response) => {
  const { businessId, memberId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  const { isActive } = req.body as { isActive?: unknown };

  if (!businessId || !memberId || !user?.uid) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  if (typeof isActive !== "boolean") {
    res.status(400).json({ error: "isActive must be a boolean" });
    return;
  }

  try {
    const result = await setTeamMemberActiveStatus({
      businessId,
      memberId,
      isActive,
      actorUid: user.uid,
    });

    if (!result.ok) {
      res.status(result.status).json({ error: result.message });
      return;
    }

    await logAuditEvent(
      isActive ? "TEAM_MEMBER_ACTIVATED" : "TEAM_MEMBER_DEACTIVATED",
      { businessId, userId: user.uid, memberId },
      null,
      { isActive },
    );

    res.status(200).json({ success: true });
  } catch (e) {
    logger.error("patchTeamMemberStatus failed", e);
    res.status(500).json({ error: "Failed to update member status" });
  }
};

/**
 * DELETE /business/:businessId/team/members/:memberId — remove member and revoke access.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const deleteTeamMember = async (req: Request, res: Response) => {
  const { businessId, memberId } = req.params;
  const user = (req as { user?: { uid: string } }).user;

  if (!businessId || !memberId || !user?.uid) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  try {
    const result = await removeTeamMember({
      businessId,
      memberId,
      actorUid: user.uid,
    });

    if (!result.ok) {
      res.status(result.status).json({ error: result.message });
      return;
    }

    await logAuditEvent(
      "TEAM_MEMBER_REMOVED",
      { businessId, userId: user.uid, memberId },
      null,
      {},
    );

    res.status(200).json({ success: true });
  } catch (e) {
    logger.error("deleteTeamMember failed", e);
    res.status(500).json({ error: "Failed to remove team member" });
  }
};

/**
 * DELETE /business/:businessId/team/invites/:inviteId — cancel pending or remove declined rows.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const deleteTeamInviteRow = async (req: Request, res: Response) => {
  const { businessId, inviteId } = req.params;
  const user = (req as { user?: { uid: string } }).user;

  if (!businessId || !inviteId || !user?.uid) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  try {
    const result = await deleteTeamHubInvite({ businessId, inviteId });
    if (!result.ok) {
      res.status(result.status).json({ error: result.message });
      return;
    }

    await logAuditEvent(
      "TEAM_INVITE_REMOVED",
      { businessId, userId: user.uid, inviteId },
      null,
      {},
    );
    res.status(200).json({ success: true });
  } catch (e) {
    logger.error("deleteTeamInviteRow failed", e);
    res.status(500).json({ error: "Failed to remove invitation" });
  }
};

/**
 * POST /business/:businessId/team/records — add a record-only rider (no login).
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const postTeamRecord = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  if (!businessId || !user?.uid) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const { name, phone, photoUrl, role } = req.body as {
    name?: string;
    phone?: string;
    photoUrl?: string;
    role?: string;
  };

  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const rawRole = String(role ?? "rider")
    .trim()
    .toLowerCase();
  if (rawRole !== "admin" && rawRole !== "rider" && rawRole !== "staff") {
    res.status(400).json({ error: "role must be \"admin\" or \"rider\"" });
    return;
  }

  try {
    const result = await createRecordOnlyRiderForHub({
      businessId,
      name,
      role: normalizeSeatRole(role),
      phone: typeof phone === "string" ? phone : undefined,
      photoUrl: typeof photoUrl === "string" ? photoUrl : undefined,
    });

    if (!result.ok) {
      res.status(result.status).json({ error: result.message });
      return;
    }

    await logAuditEvent(
      "TEAM_RECORD_RIDER_CREATED",
      { businessId, userId: user.uid, riderId: result.rider.id },
      null,
      { name: result.rider.name },
    );

    res.status(201).json({ success: true, data: result.rider });
  } catch (e) {
    logger.error("postTeamRecord failed", e);
    res.status(500).json({ error: "Failed to save record" });
  }
};

/**
 * DELETE /business/:businessId/team/records/:riderId — remove a record-only rider.
 * @param {Request} req The express request object.
 * @param {Response} res The express response object.
 * @return {Promise<void>}
 */
export const deleteTeamRecord = async (req: Request, res: Response) => {
  const { businessId, riderId } = req.params;
  const user = (req as { user?: { uid: string } }).user;

  if (!businessId || !riderId || !user?.uid) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  try {
    const result = await deleteRecordOnlyRiderFromHub({ businessId, riderId });
    if (!result.ok) {
      res.status(result.status).json({ error: result.message });
      return;
    }

    await logAuditEvent(
      "TEAM_RECORD_RIDER_REMOVED",
      { businessId, userId: user.uid, riderId },
      null,
      {},
    );
    res.status(200).json({ success: true });
  } catch (e) {
    logger.error("deleteTeamRecord failed", e);
    res.status(500).json({ error: "Failed to remove record" });
  }
};
