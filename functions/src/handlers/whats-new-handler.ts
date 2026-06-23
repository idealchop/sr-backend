import { Request, Response } from "express";
import { db } from "../config/firebase-admin";
import { syncWhatsNewReleases } from "../services/platform/whats-new-sync-service";
import { parseWhatsNewSyncBody } from "../services/platform/whats-new-types";

async function isUserSuperAdmin(uid: string): Promise<boolean> {
  const snap = await db.collection("users").doc(uid).get();
  return snap.exists && snap.data()?.superadmin === true;
}

export async function canSyncWhatsNew(uid: string): Promise<boolean> {
  if (process.env.FUNCTIONS_EMULATOR) return true;
  return isUserSuperAdmin(uid);
}

export async function postWhatsNewSync(req: Request, res: Response): Promise<void> {
  const uid = (req as Request & { user?: { uid?: string } }).user?.uid;
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!(await canSyncWhatsNew(uid))) {
    res.status(403).json({
      error: "Forbidden",
      message:
        "What's New sync is allowed in the Functions emulator or for superadmin accounts.",
    });
    return;
  }

  const releases = parseWhatsNewSyncBody(req.body);
  if (releases.length === 0) {
    res.status(400).json({ error: "No valid releases in body.releases" });
    return;
  }

  try {
    const result = await syncWhatsNewReleases(releases);
    res.status(200).json(result);
  } catch (error) {
    console.error("postWhatsNewSync failed", error);
    res.status(500).json({ error: "Failed to sync What's New releases" });
  }
}
