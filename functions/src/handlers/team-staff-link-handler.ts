import { Request, Response } from "express";
import {
  logAuditEvent,
  logger,
} from "../services/observability/logging/logger";
import {
  createStaffLink,
  exchangeStaffLink,
  revokeStaffLink,
} from "../services/team/team-staff-link-service";

type AuthedReq = Request & { user?: { uid: string } };

/** POST /business/:businessId/team/members/:memberId/staff-link (owner) — create or replace. */
export const postStaffLink = async (req: Request, res: Response) => {
  const { businessId, memberId } = req.params;
  const uid = (req as AuthedReq).user?.uid;
  if (!businessId || !memberId || !uid) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const r = await createStaffLink({ businessId, memberUid: memberId, ownerUid: uid });
    if (!r.ok) {
      res.status(r.status).json({ error: r.message });
      return;
    }
    await logAuditEvent(
      "TEAM_STAFF_LINK_CREATED",
      { businessId, userId: uid, memberId },
      null,
      { expiresAt: r.expiresAt },
    );
    res.status(201).json({ data: { token: r.token, expiresAt: r.expiresAt } });
  } catch (e) {
    logger.error("postStaffLink failed", e);
    res.status(500).json({ error: "Could not create the staff link" });
  }
};

/** DELETE /business/:businessId/team/members/:memberId/staff-link (owner) — turn off. */
export const deleteStaffLink = async (req: Request, res: Response) => {
  const { businessId, memberId } = req.params;
  const uid = (req as AuthedReq).user?.uid;
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
    logger.error("deleteStaffLink failed", e);
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
    logger.error("postExchangeStaffLink failed", e instanceof Error ? e.message : e);
    res.status(500).json({ error: "Could not open this link. Try again." });
  }
};
