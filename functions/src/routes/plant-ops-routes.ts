import express from "express";
import {
  createIotDevice,
  createPlantDowntime,
  createTankLevel,
  deleteIotDevice,
  getPlantEconomics,
  getTankLevelDashboard,
  getWrsMaintenanceGaps,
  ingestIotTelemetry,
  listIotDevices,
  listPlantDowntime,
  listTankLevels,
  updateIotDevice,
} from "../handlers/plant-ops-handler";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";

const router = express.Router(); // eslint-disable-line new-cap

router.get("/downtime/:businessId", validateFirebaseIdToken, listPlantDowntime);
router.post("/downtime/:businessId", validateFirebaseIdToken, createPlantDowntime);
router.get("/tank-levels/:businessId/dashboard", validateFirebaseIdToken, getTankLevelDashboard);
router.get("/tank-levels/:businessId", validateFirebaseIdToken, listTankLevels);
router.post("/tank-levels/:businessId", validateFirebaseIdToken, createTankLevel);
router.get("/iot-devices/:businessId", validateFirebaseIdToken, listIotDevices);
router.post("/iot-devices/:businessId", validateFirebaseIdToken, createIotDevice);
router.patch(
  "/iot-devices/:businessId/:deviceId",
  validateFirebaseIdToken,
  updateIotDevice,
);
router.delete(
  "/iot-devices/:businessId/:deviceId",
  validateFirebaseIdToken,
  deleteIotDevice,
);
router.post(
  "/iot-devices/:businessId/:deviceId/telemetry",
  validateFirebaseIdToken,
  ingestIotTelemetry,
);
router.get("/economics/:businessId", validateFirebaseIdToken, getPlantEconomics);
router.get("/wrs-gaps/:businessId", validateFirebaseIdToken, getWrsMaintenanceGaps);

export default router;
