import { Request, Response } from "express";
import { logger } from "firebase-functions";
import {
  WaterQualityLogService,
  type CreateWaterQualityLogInput,
  type WaterQualityLocationTag,
} from "../services/plant/water-quality-log-service";
import { checkBusinessAccess } from "../utils/auth-utils";

export const listWaterQualityLogs = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;

  try {
    const { hasAccess } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const limit = Math.min(90, Math.max(1, Number(req.query.limit) || 30));
    const data = await WaterQualityLogService.list(businessId, limit);
    res.json({ data });
  } catch (error) {
    logger.error(`Error listing water quality logs for ${businessId}`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const createWaterQualityLog = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;

  try {
    const { hasAccess, role } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess || role === "member") {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const locationTag = String(body.locationTag || "product") as WaterQualityLocationTag;
    if (!["product", "reject", "raw"].includes(locationTag)) {
      res.status(400).json({ error: "Invalid locationTag" });
      return;
    }

    const tdsPpm = Number(body.tdsPpm);
    if (!Number.isFinite(tdsPpm) || tdsPpm < 0) {
      res.status(400).json({ error: "tdsPpm is required" });
      return;
    }

    const input: CreateWaterQualityLogInput = {
      recordedAt: typeof body.recordedAt === "string" ? body.recordedAt : undefined,
      tdsPpm,
      ph: body.ph != null ? Number(body.ph) : undefined,
      chlorinePpm: body.chlorinePpm != null ? Number(body.chlorinePpm) : undefined,
      locationTag,
      operatorName:
        typeof body.operatorName === "string" ? body.operatorName : undefined,
      source: body.source === "device" ? "device" : "manual",
      deviceId: typeof body.deviceId === "string" ? body.deviceId : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    };

    const data = await WaterQualityLogService.create(
      businessId,
      input,
      user?.uid,
    );
    res.status(201).json({ data });
  } catch (error) {
    logger.error(`Error creating water quality log for ${businessId}`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
