import { Request, Response } from "express";
import { logger } from "firebase-functions";
import { ProductionShiftService } from "../services/plant/production-shift-service";
import { checkBusinessAccess } from "../utils/auth-utils";

export const listProductionShifts = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;

  try {
    const { hasAccess } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const limit = Number(req.query.limit);
    const data = await ProductionShiftService.list(businessId, {
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    res.json({ data });
  } catch (error) {
    logger.error(`Error listing production shifts for ${businessId}`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const upsertProductionShift = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;

  try {
    const { hasAccess, role } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess || role === "member") {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const record = await ProductionShiftService.upsert(
      businessId,
      user?.uid ?? "",
      (req.body ?? {}) as Record<string, unknown>,
    );
    res.status(201).json({ data: record });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    if (message.includes("must be")) {
      res.status(400).json({ error: message });
      return;
    }
    logger.error(`Error saving production shift for ${businessId}`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
