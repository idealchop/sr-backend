import { Request, Response } from "express";
import { logger } from "firebase-functions";
import { checkBusinessAccess } from "../utils/auth-utils";
import {
  PlantDowntimeService,
  type PlantDowntimeReason,
} from "../services/plant/plant-downtime-service";
import { TankLevelLogService } from "../services/plant/tank-level-log-service";
import {
  IotDeviceRegistryService,
  type IotDeviceType,
} from "../services/plant/iot-device-registry-service";
import { ProductionShiftService } from "../services/plant/production-shift-service";
import { TransactionService } from "../services/transactions/transaction-service";
import { computePlantCostPerGallonForDays } from "../utils/plant-cost-per-gallon";
import { computeFlowMeterReconcile } from "../utils/flow-meter-reconcile";
import { analyzeWrsMaintenanceGaps } from "../utils/wrs-maintenance-gap-analysis";
import { buildTankLowLevelInsight } from "../utils/tank-level-analytics";
import { MaintenanceTemplateService } from "../services/plant/maintenance-template-service";
import { WaterQualityLogService } from "../services/plant/water-quality-log-service";
import { CustomerService } from "../services/customers/customer-service";

export const listPlantDowntime = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  try {
    const { hasAccess } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const data = await PlantDowntimeService.list(businessId);
    res.json({ data });
  } catch (error) {
    logger.error("listPlantDowntime", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const createPlantDowntime = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  try {
    const { hasAccess, role } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess || role === "member") {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const expenseRaw = body.expense;
    const expense =
      expenseRaw && typeof expenseRaw === "object" ?
        {
          amount: Number((expenseRaw as Record<string, unknown>).amount),
          note:
            typeof (expenseRaw as Record<string, unknown>).note === "string" ?
              (expenseRaw as Record<string, unknown>).note as string :
              undefined,
        } :
        undefined;
    const data = await PlantDowntimeService.create(
      businessId,
      {
        startedAt: typeof body.startedAt === "string" ? body.startedAt : undefined,
        endedAt: typeof body.endedAt === "string" ? body.endedAt : undefined,
        reasonCode: String(body.reasonCode || "other") as PlantDowntimeReason,
        notes: typeof body.notes === "string" ? body.notes : undefined,
        estimatedGallonsLost:
        body.estimatedGallonsLost != null ? Number(body.estimatedGallonsLost) : undefined,
        expenseId: typeof body.expenseId === "string" ? body.expenseId : undefined,
        expense: expense && Number.isFinite(expense.amount) && expense.amount > 0 ?
          expense :
          undefined,
        severity:
        body.severity === "low" || body.severity === "high" || body.severity === "medium" ?
          body.severity :
          undefined,
      },
      user?.uid,
    );
    res.status(201).json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    if (message.includes("overlap") || message.includes("must be after")) {
      res.status(400).json({ error: message });
      return;
    }
    logger.error("createPlantDowntime", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const updatePlantDowntime = async (req: Request, res: Response) => {
  const { businessId, downtimeId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  try {
    const { hasAccess, role } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess || role === "member") {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = await PlantDowntimeService.updateById(businessId, downtimeId, {
      startedAt: typeof body.startedAt === "string" ? body.startedAt : undefined,
      endedAt:
        body.endedAt === null ?
          null :
          typeof body.endedAt === "string" ?
            body.endedAt :
            undefined,
      reasonCode: String(body.reasonCode || "other") as PlantDowntimeReason,
      notes: typeof body.notes === "string" ? body.notes : undefined,
      estimatedGallonsLost:
        body.estimatedGallonsLost === null ?
          null :
          body.estimatedGallonsLost != null ?
            Number(body.estimatedGallonsLost) :
            undefined,
      severity:
        body.severity === "low" || body.severity === "high" || body.severity === "medium" ?
          body.severity :
          undefined,
    });
    res.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    if (
      message.includes("not found") ||
      message.includes("overlap") ||
      message.includes("must be after") ||
      message.includes("Invalid")
    ) {
      res.status(400).json({ error: message });
      return;
    }
    logger.error("updatePlantDowntime", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const deletePlantDowntime = async (req: Request, res: Response) => {
  const { businessId, downtimeId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  try {
    const { hasAccess, role } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess || role === "member") {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    await PlantDowntimeService.delete(businessId, downtimeId);
    res.json({ data: { deleted: true } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    if (message.includes("not found")) {
      res.status(400).json({ error: message });
      return;
    }
    logger.error("deletePlantDowntime", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const listTankLevels = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  try {
    const { hasAccess } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const data = await TankLevelLogService.list(businessId);
    res.json({ data });
  } catch (error) {
    logger.error("listTankLevels", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const createTankLevel = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  try {
    const { hasAccess, role } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess || role === "member") {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = await TankLevelLogService.create(businessId, {
      recordedAt: typeof body.recordedAt === "string" ? body.recordedAt : undefined,
      rawPct: body.rawPct != null ? Number(body.rawPct) : undefined,
      productPct: body.productPct != null ? Number(body.productPct) : undefined,
      rejectPct: body.rejectPct != null ? Number(body.rejectPct) : undefined,
      source: body.source === "device" ? "device" : "manual",
      deviceId: typeof body.deviceId === "string" ? body.deviceId : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    });
    res.status(201).json({ data });
  } catch (error) {
    logger.error("createTankLevel", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const updateTankLevel = async (req: Request, res: Response) => {
  const { businessId, logId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  try {
    const { hasAccess, role } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess || role === "member") {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = await TankLevelLogService.updateById(businessId, logId, {
      rawPct: body.rawPct != null ? Number(body.rawPct) : undefined,
      productPct: body.productPct != null ? Number(body.productPct) : undefined,
      rejectPct: body.rejectPct != null ? Number(body.rejectPct) : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    });
    res.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    if (message.includes("not found") || message.includes("cannot be edited")) {
      res.status(400).json({ error: message });
      return;
    }
    if (message.includes("required")) {
      res.status(400).json({ error: message });
      return;
    }
    logger.error("updateTankLevel", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const deleteTankLevel = async (req: Request, res: Response) => {
  const { businessId, logId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  try {
    const { hasAccess, role } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess || role === "member") {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    await TankLevelLogService.delete(businessId, logId);
    res.json({ data: { deleted: true } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    if (message.includes("not found") || message.includes("cannot be removed")) {
      res.status(400).json({ error: message });
      return;
    }
    logger.error("deleteTankLevel", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const listIotDevices = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  try {
    const { hasAccess } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const data = await IotDeviceRegistryService.list(businessId);
    res.json({ data });
  } catch (error) {
    logger.error("listIotDevices", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const createIotDevice = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  try {
    const { hasAccess, role } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess || role === "member") {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const deviceType = String(body.deviceType || "generic") as IotDeviceType;
    const data = await IotDeviceRegistryService.create(businessId, {
      name: String(body.name || ""),
      deviceType,
      serialNumber: typeof body.serialNumber === "string" ? body.serialNumber : undefined,
      locationTag: typeof body.locationTag === "string" ? body.locationTag : undefined,
      calibrationDate:
        typeof body.calibrationDate === "string" ? body.calibrationDate : undefined,
      active: body.active !== false,
    });
    res.status(201).json({ data: data.device, ingestKey: data.ingestKey });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    if (message.includes("required")) {
      res.status(400).json({ error: message });
      return;
    }
    logger.error("createIotDevice", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const updateIotDevice = async (req: Request, res: Response) => {
  const { businessId, deviceId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  try {
    const { hasAccess, role } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess || role === "member") {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = await IotDeviceRegistryService.update(businessId, deviceId, {
      name: typeof body.name === "string" ? body.name : undefined,
      serialNumber:
        body.serialNumber !== undefined ?
          (typeof body.serialNumber === "string" ? body.serialNumber : "") :
          undefined,
      locationTag:
        body.locationTag !== undefined ?
          (typeof body.locationTag === "string" ? body.locationTag : "") :
          undefined,
      calibrationDate:
        body.calibrationDate !== undefined ?
          (typeof body.calibrationDate === "string" ? body.calibrationDate : null) :
          undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
    });
    res.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    if (message.includes("not found")) {
      res.status(404).json({ error: message });
      return;
    }
    logger.error("updateIotDevice", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const rotateIotDeviceIngestKey = async (req: Request, res: Response) => {
  const { businessId, deviceId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  try {
    const { hasAccess, role } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess || role === "member") {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const result = await IotDeviceRegistryService.rotateIngestKey(businessId, deviceId);
    res.json({ data: result.device, ingestKey: result.ingestKey });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    if (message.includes("not found")) {
      res.status(404).json({ error: message });
      return;
    }
    logger.error("rotateIotDeviceIngestKey", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const deleteIotDevice = async (req: Request, res: Response) => {
  const { businessId, deviceId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  try {
    const { hasAccess, role } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess || role === "member") {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    await IotDeviceRegistryService.delete(businessId, deviceId);
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    if (message.includes("not found")) {
      res.status(404).json({ error: message });
      return;
    }
    logger.error("deleteIotDevice", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const ingestIotTelemetry = async (req: Request, res: Response) => {
  const { businessId, deviceId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  try {
    const { hasAccess, role } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess || role === "member") {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const payload =
      body.payload && typeof body.payload === "object" ?
        (body.payload as Record<string, unknown>) :
        body;
    const data = await IotDeviceRegistryService.ingestTelemetry(
      businessId,
      deviceId,
      payload,
    );
    res.status(201).json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    if (message.includes("not found")) {
      res.status(404).json({ error: message });
      return;
    }
    logger.error("ingestIotTelemetry", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getPlantEconomics = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  try {
    const { hasAccess } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
    const [shifts, transactions, iotGallonsTotal] = await Promise.all([
      ProductionShiftService.list(businessId, { limit: 90 }),
      TransactionService.getTransactionsByBusiness(businessId, { limit: 2000 }),
      IotDeviceRegistryService.sumFlowGallons(businessId, days),
    ]);
    const cost = computePlantCostPerGallonForDays({ shifts, transactions, days });
    const flow = computeFlowMeterReconcile({
      shifts,
      businessId,
      iotGallonsTotal: iotGallonsTotal > 0 ? iotGallonsTotal : undefined,
    });
    res.json({ data: { cost, flow } });
  } catch (error) {
    logger.error("getPlantEconomics", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getWrsMaintenanceGaps = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  try {
    const { hasAccess } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const [templates, customers, transactions, qualityLogs] = await Promise.all([
      MaintenanceTemplateService.list(businessId),
      CustomerService.getCustomersByBusiness(businessId),
      TransactionService.getTransactionsByBusiness(businessId, { limit: 500 }),
      WaterQualityLogService.list(businessId, 200),
    ]);
    const data = analyzeWrsMaintenanceGaps({ templates, customers, transactions, qualityLogs });
    res.json({ data });
  } catch (error) {
    logger.error("getWrsMaintenanceGaps", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/** MP-23 — tank dashboard from manual logs + latest IoT level readings. */
export const getTankLevelDashboard = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  try {
    const { hasAccess } = await checkBusinessAccess(user?.uid ?? "", businessId);
    if (!hasAccess) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const days = Math.min(90, Math.max(7, Number(req.query.days) || 30));
    const [latest, trend, devices] = await Promise.all([
      TankLevelLogService.latestSnapshot(businessId),
      TankLevelLogService.list(businessId, days),
      IotDeviceRegistryService.list(businessId),
    ]);

    const levelDevices = devices.filter((d) => d.deviceType === "tank_level" && d.active);
    const telemetry = await IotDeviceRegistryService.latestTelemetryByDevices(
      businessId,
      levelDevices.map((d) => d.id),
    );

    const iot = levelDevices.map((device) => {
      const reading = telemetry[device.id];
      const payload = reading?.payload ?? {};
      const levelPct = Number(payload.levelPct ?? payload.value ?? payload.pct);
      return {
        deviceId: device.id,
        name: device.name,
        locationTag: device.locationTag ?? null,
        levelPct: Number.isFinite(levelPct) ? levelPct : null,
        recordedAt: reading?.recordedAt ?? device.lastSeenAt ?? null,
      };
    });

    const lowLevelInsight = buildTankLowLevelInsight({ latest, iot });

    res.json({
      data: {
        latest,
        trend,
        iot,
        lowLevelInsight,
      },
    });
  } catch (error) {
    logger.error("getTankLevelDashboard", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
