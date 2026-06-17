import { Request, Response } from "express";
import { logger } from "firebase-functions";
import { MaintenanceTemplateService } from "../services/plant/maintenance-template-service";
import { summarizeMaintenanceOverdue } from "../services/plant/maintenance-template-utils";
import { checkBusinessAccess } from "../utils/auth-utils";

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

    const record = await MaintenanceTemplateService.complete(businessId, templateId);
    res.json({ data: record });
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
