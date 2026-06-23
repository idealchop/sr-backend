import express from "express";
import {
  createIotDevice,
  createPlantDowntime,
  deletePlantDowntime,
  createTankLevel,
  deleteIotDevice,
  deleteTankLevel,
  getPlantEconomics,
  getTankLevelDashboard,
  getWrsMaintenanceGaps,
  ingestIotTelemetry,
  listIotDevices,
  listPlantDowntime,
  listTankLevels,
  rotateIotDeviceIngestKey,
  updateIotDevice,
  updatePlantDowntime,
  updateTankLevel,
} from "../handlers/plant-ops-handler";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";

const router = express.Router(); // eslint-disable-line new-cap

router.get("/downtime/:businessId", validateFirebaseIdToken, listPlantDowntime);
router.post("/downtime/:businessId", validateFirebaseIdToken, createPlantDowntime);
router.put("/downtime/:businessId/:downtimeId", validateFirebaseIdToken, updatePlantDowntime);
router.delete("/downtime/:businessId/:downtimeId", validateFirebaseIdToken, deletePlantDowntime);
router.get("/tank-levels/:businessId/dashboard", validateFirebaseIdToken, getTankLevelDashboard);
router.get("/tank-levels/:businessId", validateFirebaseIdToken, listTankLevels);
router.post("/tank-levels/:businessId", validateFirebaseIdToken, createTankLevel);
router.put("/tank-levels/:businessId/:logId", validateFirebaseIdToken, updateTankLevel);
router.delete("/tank-levels/:businessId/:logId", validateFirebaseIdToken, deleteTankLevel);
router.get("/iot-devices/:businessId", validateFirebaseIdToken, listIotDevices);
router.post("/iot-devices/:businessId", validateFirebaseIdToken, createIotDevice);
router.patch(
  "/iot-devices/:businessId/:deviceId",
  validateFirebaseIdToken,
  updateIotDevice,
);
router.post(
  "/iot-devices/:businessId/:deviceId/rotate-key",
  validateFirebaseIdToken,
  rotateIotDeviceIngestKey,
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
