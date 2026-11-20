import { Request, Response } from "express";
import {
  logAuditEvent,
  logger,
} from "../services/observability/logging/logger";
import {
  createStaffLink,
  exchangeStaffLink,
  getStaffLink,
  revokeStaffLink,
  type StaffLinkResult,
} from "../services/team/team-staff-link-service";
import { addLinkStaffMember } from "../services/team/team-add-staff-service";

type AuthedUser = { uid?: string; staffLink?: boolean };
type AuthedReq = Request & { user?: AuthedUser };

/** Staff-link sessions are rider seats, not owners, and cannot copy or issue links. */
export const STAFF_LINK_OWNER_ONLY_CODE = "staff_link_owner_only";

function rejectStaffLinkSession(req: Request, res: Response): boolean {
  if ((req as AuthedReq).user?.staffLink === true) {
    res.status(403).json({
      error: "Only the workspace owner can perform this action.",
      code: STAFF_LINK_OWNER_ONLY_CODE,
    });
    return true;
  }
  return false;
}

function sendStaffLinkResult(res: Response, result: StaffLinkResult, createdStatus = 200) {
  if (!result.ok) {
    const body: { error: string; code?: string } = { error: result.message };
    if (result.code) body.code = result.code;
    res.status(result.status).json(body);
    return;
  }
  res.status(result.issued ? createdStatus : 200).json({
    data: { token: result.token, expiresAt: result.expiresAt },
  });
}

/**
 * GET /business/:businessId/team/members/:memberId/staff-link (owner).
 * Returns the current link. Does not create or rotate one.
 */
export const getStaffLinkHandler = async (req: Request, res: Response) => {
  const { businessId, memberId } = req.params;
  const uid = (req as AuthedReq).user?.uid;
  if (rejectStaffLinkSession(req, res)) return;
  if (!businessId || !memberId || !uid) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const r = await getStaffLink({ businessId, memberUid: memberId });
    sendStaffLinkResult(res, r);
  } catch (e) {
    logger.error("getStaffLink failed", e instanceof Error ? e.message : "error");
    res.status(500).json({ error: "Could not read the staff link" });
  }
};

/**
 * POST /business/:businessId/team/members/:memberId/staff-link (owner).
 * First issuance only. Repeating it returns the same link and does not revoke sessions.
 */
export const postStaffLink = async (req: Request, res: Response) => {
  const { businessId, memberId } = req.params;
  const uid = (req as AuthedReq).user?.uid;
  if (rejectStaffLinkSession(req, res)) return;
  if (!businessId || !memberId || !uid) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const r = await createStaffLink({ businessId, memberUid: memberId, ownerUid: uid });
    if (!r.ok) {
      sendStaffLinkResult(res, r);
      return;
    }
    if (r.issued) {
      await logAuditEvent(
        "TEAM_STAFF_LINK_CREATED",
        { businessId, userId: uid, memberId },
        null,
        { expiresAt: r.expiresAt },
      );
    }
    sendStaffLinkResult(res, r, 201);
  } catch (e) {
    logger.error("postStaffLink failed", e instanceof Error ? e.message : "error");
    res.status(500).json({ error: "Could not create the staff link" });
  }
};

/** DELETE /business/:businessId/team/members/:memberId/staff-link (owner) — turn off. */
export const deleteStaffLink = async (req: Request, res: Response) => {
  const { businessId, memberId } = req.params;
  const uid = (req as AuthedReq).user?.uid;
  if (rejectStaffLinkSession(req, res)) return;
  if (!businessId || !memberId || !uid) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const r = await revokeStaffLink({ businessId, memberUid: memberId });
    if (!r.ok) {
      res.status(r.status).json({ error: r.message });
      return;
    }
    await logAuditEvent(
      "TEAM_STAFF_LINK_REVOKED",
      { businessId, userId: uid, memberId },
      null,
      {},
    );
    res.json({ success: true });
  } catch (e) {
    logger.error("deleteStaffLink failed", e instanceof Error ? e.message : "error");
    res.status(500).json({ error: "Could not turn off the staff link" });
  }
};

/** POST /public/staff-link/exchange { token } — no login; returns a custom token. */
export const postExchangeStaffLink = async (req: Request, res: Response) => {
  try {
    const r = await exchangeStaffLink(req.body?.token);
    if (!r.ok) {
      res.status(r.status).json({ error: r.message });
      return;
    }
    res.json({ data: { customToken: r.customToken, businessId: r.businessId } });
  } catch (e) {
    // Never log the token itself.
    logger.error("postExchangeStaffLink failed", e instanceof Error ? e.message : "error");
    res.status(500).json({ error: "Could not open this link. Try again." });
  }
};

/** POST /business/:businessId/team/staff (owner) — Barbers.ph-style add staff + link. */
export const postAddStaff = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const uid = (req as AuthedReq).user?.uid;
  if (!businessId || !uid) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { name, phone } = (req.body || {}) as { name?: unknown; phone?: unknown };
  try {
    const r = await addLinkStaffMember({
      businessId,
      ownerUid: uid,
      name: typeof name === "string" ? name : "",
      phone: typeof phone === "string" ? phone : undefined,
    });
    if (!r.ok) {
      res.status(r.status).json({ error: r.message });
      return;
    }
    await logAuditEvent(
      "TEAM_LINK_STAFF_ADDED",
      { businessId, userId: uid, memberId: r.member.id },
      null,
      { expiresAt: r.expiresAt },
    );
    res.status(201).json({ data: r });
  } catch (e) {
    logger.error("postAddStaff failed", e);
    res.status(500).json({ error: "Could not add this staff member" });
  }
};
