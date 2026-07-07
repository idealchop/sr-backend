import { Request, Response } from "express";
import { logger } from "../services/observability/logging/logger";
import { TeamMessengerLinkService } from "../services/team/team-messenger-link-service";

function requireOwnerOrAdmin(req: Request): boolean {
  const role = (req as { businessRole?: string }).businessRole;
  return role === "owner" || role === "admin";
}

export async function postTeamMessengerLinkCodeMe(req: Request, res: Response): Promise<void> {
  const { businessId } = req.params;
  const uid = (req as { user?: { uid?: string } }).user?.uid;
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!requireOwnerOrAdmin(req)) {
    res.status(403).json({ error: "Only owner or admin can connect Messenger for team chat." });
    return;
  }

  try {
    const data = await TeamMessengerLinkService.createLinkCode({ businessId, userId: uid });
    res.json({ success: true, data });
  } catch (error) {
    logger.error("postTeamMessengerLinkCodeMe failed", error);
    const message = error instanceof Error ? error.message : "Failed to create link code";
    res.status(400).json({ error: message });
  }
}

export async function getTeamMessengerLinkStatusMe(req: Request, res: Response): Promise<void> {
  const { businessId } = req.params;
  const uid = (req as { user?: { uid?: string } }).user?.uid;
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!requireOwnerOrAdmin(req)) {
    res.status(403).json({ error: "Only owner or admin can view Messenger link status." });
    return;
  }

  try {
    const data = await TeamMessengerLinkService.getLinkStatus({ businessId, userId: uid });
    res.json({ success: true, data });
  } catch (error) {
    logger.error("getTeamMessengerLinkStatusMe failed", error);
    res.status(500).json({ error: "Failed to read link status" });
  }
}

export async function deleteTeamMessengerLinkMe(req: Request, res: Response): Promise<void> {
  const { businessId } = req.params;
  const uid = (req as { user?: { uid?: string } }).user?.uid;
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!requireOwnerOrAdmin(req)) {
    res.status(403).json({ error: "Only owner or admin can unlink Messenger." });
    return;
  }

  try {
    await TeamMessengerLinkService.unlinkMember({ businessId, userId: uid });
    res.json({ success: true });
  } catch (error) {
    logger.error("deleteTeamMessengerLinkMe failed", error);
    res.status(500).json({ error: "Failed to unlink Messenger" });
  }
}
