import { Request, Response } from "express";
import { logger } from "firebase-functions";
import { MaintenanceTemplateService } from "../services/plant/maintenance-template-service";
import { summarizeMaintenanceOverdue } from "../services/plant/maintenance-template-utils";
import {
  ensureStaffQrToken,
  readPlantConfig,
  tokenMatches,
} from "../utils/plant-staff-token";

function parseQueryToken(req: Request): string | undefined {
  const q = req.query.token ?? req.query.t;
  return typeof q === "string" && q.trim() ? q.trim() : undefined;
}

function parseBusinessId(req: Request): string | undefined {
  const b = req.query.b ?? req.query.businessId;
  return typeof b === "string" && b.trim() ? b.trim() : undefined;
}

async function validateStaffAccess(
  businessId: string,
  token: string | undefined,
): Promise<boolean> {
  const snap = await import("../config/firebase-admin").then((m) =>
    m.db.collection("businesses").doc(businessId).get(),
  );
  if (!snap.exists) return false;
  const plantConfig = readPlantConfig(snap.data() ?? {});
  return tokenMatches(plantConfig, token);
}

/** MP-10 — list due/overdue maintenance tasks for staff QR page. */
export async function getPublicPlantMaintenanceTasks(
  req: Request,
  res: Response,
): Promise<void> {
  const businessId = parseBusinessId(req);
  const token = parseQueryToken(req);
  if (!businessId || !token) {
    res.status(400).json({ error: "b and token are required" });
    return;
  }

  try {
    if (!(await validateStaffAccess(businessId, token))) {
      res.status(403).json({ error: "Invalid staff token" });
      return;
    }

    const templates = await MaintenanceTemplateService.list(businessId);
    const summary = summarizeMaintenanceOverdue(templates);
    const dueToday = templates.filter((t) => {
      if (!t.nextDueAt) return false;
      const due = new Date(t.nextDueAt);
      const now = new Date();
      return due.toDateString() === now.toDateString() || due < now;
    });

    res.json({
      data: dueToday,
      summary,
      businessId,
    });
  } catch (error) {
    logger.error("getPublicPlantMaintenanceTasks failed", { businessId, error });
    res.status(500).json({ error: "Internal Server Error" });
  }
}

/** MP-10 — complete maintenance task from staff QR (no owner login). */
export async function postPublicPlantMaintenanceComplete(
  req: Request,
  res: Response,
): Promise<void> {
  const businessId = parseBusinessId(req);
  const token = parseQueryToken(req);
  const templateId = typeof req.body?.templateId === "string" ?
    req.body.templateId.trim() :
    "";

  if (!businessId || !token || !templateId) {
    res.status(400).json({ error: "b, token, and templateId are required" });
    return;
  }

  try {
    if (!(await validateStaffAccess(businessId, token))) {
      res.status(403).json({ error: "Invalid staff token" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await MaintenanceTemplateService.complete(
      businessId,
      templateId,
      {
        userId: "staff_qr",
        checklistChecked: Array.isArray(body.checklistChecked) ?
          body.checklistChecked.map((v) => v === true) :
          undefined,
        proofUrl:
          typeof body.proofUrl === "string" && body.proofUrl.trim() ?
            body.proofUrl.trim() :
            undefined,
        notes:
          typeof body.notes === "string" && body.notes.trim() ?
            body.notes.trim().slice(0, 500) :
            undefined,
        decrementConsumables: body.decrementConsumables === true,
      },
    );

    res.json({ data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    if (message === "Maintenance template not found") {
      res.status(404).json({ error: message });
      return;
    }
    logger.error("postPublicPlantMaintenanceComplete failed", {
      businessId,
      templateId,
      error,
    });
    res.status(500).json({ error: "Internal Server Error" });
  }
}

/** MP-10 — return or rotate staff QR token (owner only via separate route). */
export async function getPublicPlantStaffTokenHint(
  req: Request,
  res: Response,
): Promise<void> {
  const businessId = parseBusinessId(req);
  if (!businessId) {
    res.status(400).json({ error: "b is required" });
    return;
  }
  res.status(404).json({ error: "Use authenticated plant settings to view staff QR" });
}

export async function ensurePlantStaffTokenForBusiness(
  businessId: string,
): Promise<string> {
  return ensureStaffQrToken(businessId);
}
