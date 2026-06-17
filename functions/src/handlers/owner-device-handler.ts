import { Request, Response } from "express";
import { logger } from "firebase-functions";
import {
  deleteOwnerDevice,
  listOwnerDevices,
  registerOwnerDevice,
} from "../services/notifications/owner-device-service";

export const listOwnerDevicesHandler = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  try {
    const devices = await listOwnerDevices(businessId);
    res.json({
      data: devices.map((device) => ({
        id: device.id,
        platform: device.platform,
        updatedAt: device.updatedAt,
      })),
    });
  } catch (error) {
    logger.error("listOwnerDevices failed", { businessId, error });
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const registerOwnerDeviceHandler = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  if (!user?.uid) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const device = await registerOwnerDevice(businessId, user.uid, {
      fcmToken: req.body?.fcmToken,
      platform: req.body?.platform,
    });
    res.json({
      data: {
        id: device.id,
        platform: device.platform,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    if (message.includes("required")) {
      return res.status(400).json({ error: message });
    }
    logger.error("registerOwnerDevice failed", { businessId, error });
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const deleteOwnerDeviceHandler = async (req: Request, res: Response) => {
  const { businessId, deviceId } = req.params;
  try {
    await deleteOwnerDevice(businessId, deviceId);
    res.json({ success: true });
  } catch (error) {
    logger.error("deleteOwnerDevice failed", { businessId, deviceId, error });
    res.status(500).json({ error: "Internal Server Error" });
  }
};
