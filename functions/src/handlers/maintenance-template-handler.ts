import { Request, Response } from "express";
import { logger } from "firebase-functions";
import { MaintenanceTemplateService } from "../services/plant/maintenance-template-service";
import { summarizeMaintenanceOverdue } from "../services/plant/maintenance-template-utils";
import { checkBusinessAccess } from "../utils/auth-utils";
import { ensureStaffQrToken } from "../utils/plant-staff-token";

export const listMaintenanceTemplates = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;

  try {
    const { hasAccess } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const data = await MaintenanceTemplateService.list(businessId);
    const summary = summarizeMaintenanceOverdue(data);
    res.json({ data, summary });
  } catch (error) {
    logger.error(`Error listing maintenance templates for ${businessId}`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const completeMaintenanceTemplate = async (req: Request, res: Response) => {
  const { businessId, templateId } = req.params;
  const user = (req as { user?: { uid: string } }).user;

  try {
    const { hasAccess, role } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess || role === "member") {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const expenseRaw =
      body.expense && typeof body.expense === "object" ?
        (body.expense as Record<string, unknown>) :
        null;

    const result = await MaintenanceTemplateService.complete(
      businessId,
      templateId,
      {
        userId: user?.uid ?? "",
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
        expense:
          expenseRaw && Number(expenseRaw.amount) > 0 ?
            {
              amount: Number(expenseRaw.amount),
              note:
                typeof expenseRaw.note === "string" ?
                  expenseRaw.note.trim().slice(0, 200) :
                  undefined,
            } :
            undefined,
      },
    );
    res.json({ data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    if (message === "Maintenance template not found") {
      res.status(404).json({ error: message });
      return;
    }
    logger.error(`Error completing maintenance template ${templateId}`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const updateMaintenanceTemplate = async (req: Request, res: Response) => {
  const { businessId, templateId } = req.params;
  const user = (req as { user?: { uid: string } }).user;

  try {
    const { hasAccess, role } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess || role === "member") {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!("dueAfterGallons" in body)) {
      res.status(400).json({ error: "dueAfterGallons is required" });
      return;
    }

    const raw = body.dueAfterGallons;
    const dueAfterGallons =
      raw === null || raw === "" ?
        null :
        Number(raw);

    const template = await MaintenanceTemplateService.updateDueAfterGallons(
      businessId,
      templateId,
      dueAfterGallons,
    );
    res.json({ data: template });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    if (message === "Maintenance template not found") {
      res.status(404).json({ error: message });
      return;
    }
    logger.error(`Error updating maintenance template ${templateId}`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getPlantStaffQrToken = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;

  try {
    const { hasAccess, role } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess || role === "member") {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const token = await ensureStaffQrToken(businessId);
    res.json({ data: { token } });
  } catch (error) {
    logger.error(`Error resolving staff QR for ${businessId}`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
