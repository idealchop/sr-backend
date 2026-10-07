import { Request, Response } from "express";
import { db } from "../config/firebase-admin";
import {
  isWorkspaceInactivityDeactivated,
  reactivateWorkspaceAfterInactivity,
} from "../services/notifications/inactive-account-deactivation-service";

/** GET /business/:businessId/inactivity-status */
export async function getInactivityStatus(
  req: Request,
  res: Response,
): Promise<void> {
  const { businessId } = req.params;
  if (!businessId) {
    res.status(400).json({ error: "Business ID is required" });
    return;
  }
  const snap = await db.collection("businesses").doc(businessId).get();
  if (!snap.exists) {
    res.status(404).json({ error: "Business not found" });
    return;
  }
  const data = snap.data() ?? {};
  const deactivated = isWorkspaceInactivityDeactivated(data);
  res.json({
    businessId,
    deactivated,
    inactivityReason: deactivated ? data.inactivityReason ?? "unused_30_days" : null,
    inactivityDeactivatedAt: data.inactivityDeactivatedAt ?? null,
  });
}

/** POST /business/:businessId/inactivity/reactivate — owner only. */
export async function postInactivityReactivate(
  req: Request,
  res: Response,
): Promise<void> {
  const { businessId } = req.params;
  const role = (req as { businessRole?: string }).businessRole;
  if (!businessId) {
    res.status(400).json({ error: "Business ID is required" });
    return;
  }
  if (role !== "owner") {
    res.status(403).json({
      error: "Only the workspace owner can reactivate this station.",
    });
    return;
  }
  await reactivateWorkspaceAfterInactivity(businessId);
  res.json({ ok: true, deactivated: false });
}
