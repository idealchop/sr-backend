import { Request, Response } from "express";
import { logger } from "firebase-functions";
import {
  acceptTeamInvite,
  completeStaffOnboarding,
  declineTeamInvite,
  getTeamInvitePreview,
} from "../services/team/team-invite-accept-service";

export const getPublicTeamInvite = async (req: Request, res: Response) => {
  const token = String(req.params.token || "").trim();
  if (!token) {
    res.status(400).json({ error: "Token is required" });
    return;
  }

  try {
    const preview = await getTeamInvitePreview(token);
    if (!preview) {
      res.status(404).json({ error: "Invitation not found" });
      return;
    }
    res.json({ data: preview });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("getPublicTeamInvite failed", { error: message });
    const looksConfig =
      /FAILED_PRECONDITION|failed_precondition/i.test(message) ||
      message.includes("indexes?create_composite");
    res.status(503).json({
      error: looksConfig ?
        "We could not open this invitation (database configuration). " +
        "Please ask your administrator to resend after deployment finishes." :
        "We could not validate this invitation. Please ask your administrator to resend.",
    });
  }
};

export const postAcceptTeamInvite = async (req: Request, res: Response) => {
  const token = String(req.params.token || "").trim();
  const user = (
    req as { user?: { uid: string; email?: string; name?: string } }
  ).user;

  if (!user?.uid) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const result = await acceptTeamInvite({
      token,
      uid: user.uid,
      email: user.email || "",
      displayName: user.name || "",
    });

    if (!result.ok) {
      res.status(result.status).json({ error: result.message });
      return;
    }

    res.json({ data: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("postAcceptTeamInvite failed", error);
    res.status(500).json({ error: message });
  }
};

export const postDeclineTeamInvite = async (req: Request, res: Response) => {
  const token = String(req.params.token || "").trim();
  const user = (req as { user?: { uid: string; email?: string } }).user;

  if (!user?.uid) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const result = await declineTeamInvite({
      token,
      uid: user.uid,
      email: user.email || "",
    });

    if (!result.ok) {
      res.status(result.status).json({ error: result.message });
      return;
    }

    res.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("postDeclineTeamInvite failed", error);
    res.status(500).json({ error: message });
  }
};

export const postCompleteStaffOnboarding = async (
  req: Request,
  res: Response,
) => {
  const user = (req as { user?: { uid: string } }).user;
  const businessId = String(req.body?.businessId || "").trim();

  if (!user?.uid) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!businessId) {
    res.status(400).json({ error: "businessId is required" });
    return;
  }

  try {
    await completeStaffOnboarding(user.uid, businessId);
    res.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("postCompleteStaffOnboarding failed", error);
    res.status(500).json({ error: message });
  }
};
