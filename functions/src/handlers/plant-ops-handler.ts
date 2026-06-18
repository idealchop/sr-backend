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
import { computePlantCostPerGallon } from "../utils/plant-cost-per-gallon";
import { computeFlowMeterReconcile } from "../utils/flow-meter-reconcile";
import { analyzeWrsMaintenanceGaps } from "../utils/wrs-maintenance-gap-analysis";
import { MaintenanceTemplateService } from "../services/plant/maintenance-template-service";
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
    const data = await PlantDowntimeService.create(businessId, {
      startedAt: typeof body.startedAt === "string" ? body.startedAt : undefined,
      endedAt: typeof body.endedAt === "string" ? body.endedAt : undefined,
      reasonCode: String(body.reasonCode || "other") as PlantDowntimeReason,
      notes: typeof body.notes === "string" ? body.notes : undefined,
      estimatedGallonsLost:
        body.estimatedGallonsLost != null ? Number(body.estimatedGallonsLost) : undefined,
      expenseId: typeof body.expenseId === "string" ? body.expenseId : undefined,
      severity:
        body.severity === "low" || body.severity === "high" || body.severity === "medium" ?
          body.severity :
          undefined,
    });
    res.status(201).json({ data });
  } catch (error) {
    logger.error("createPlantDowntime", error);
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
      active: body.active !== false,
    });
    res.status(201).json({ data });
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
    const cost = computePlantCostPerGallon({ shifts, transactions, days });
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
    const [templates, customers, transactions] = await Promise.all([
      MaintenanceTemplateService.list(businessId),
      CustomerService.getCustomersByBusiness(businessId),
      TransactionService.getTransactionsByBusiness(businessId, { limit: 500 }),
    ]);
    const data = analyzeWrsMaintenanceGaps({ templates, customers, transactions });
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
    const [latest, trend, devices] = await Promise.all([
      TankLevelLogService.latestSnapshot(businessId),
      TankLevelLogService.list(businessId, 30),
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

    const lowInsight =
      latest && (latest.productPct ?? 100) < 15 ?
        "Product tank below 15% — refill before peak hour." :
        iot.some((row) => row.levelPct != null && row.levelPct < 15) ?
          "IoT sensor reports low product tank level." :
          null;

    res.json({
      data: {
        latest,
        trend,
        iot,
        lowLevelInsight: lowInsight,
      },
    });
  } catch (error) {
    logger.error("getTankLevelDashboard", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
