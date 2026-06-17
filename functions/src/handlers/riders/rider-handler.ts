import { Request, Response } from "express";
import { RiderService } from "../../services/riders/rider-service";
import { RiderTrackingService } from "../../services/riders/rider-tracking-service";
import {
  logger,
  logAuditEvent,
} from "../../services/observability/logging/logger";
import {
  notifyBusinessMembers,
  notifyRiderProfileUpdated,
} from "../../services/notifications/station-activity-notification-service";

export const riderHandler = {
  async listRiders(req: Request, res: Response) {
    try {
      const { businessId } = req.params;
      const riders = await RiderService.getRidersByBusiness(businessId);
      res.json({ data: riders });
    } catch (error) {
      logger.error("Error listing riders", error);
      res.status(500).json({ error: "Failed to list riders" });
    }
  },

  async getRider(req: Request, res: Response) {
    try {
      const { businessId, id } = req.params;
      const rider = await RiderService.getRider(businessId, id);
      if (!rider) return res.status(404).json({ error: "Rider not found" });
      res.json({ data: rider });
    } catch (error) {
      logger.error("Error getting rider", error);
      res.status(500).json({ error: "Failed to get rider" });
    }
  },

  async createRider(req: Request, res: Response) {
    const { businessId } = req.params;
    const user = (req as any).user;
    try {
      const rider = await RiderService.addRider(businessId, req.body);

      await logAuditEvent(
        "RIDER_CREATED",
        {
          businessId,
          userId: user.uid,
          riderId: rider.id,
        },
        null,
        req.body,
      );

      await notifyBusinessMembers(businessId, {
        title: "New rider added",
        message: `${rider.name} joined your delivery team.`,
        type: "success",
        metadata: { reviewTab: "operations", category: "rider", riderId: rider.id },
      });

      res.status(201).json({ data: rider });
    } catch (error) {
      logger.error("Error creating rider", error);
      res.status(500).json({ error: "Failed to create rider" });
    }
  },

  async updateRider(req: Request, res: Response) {
    const { businessId, id } = req.params;
    const user = (req as any).user;
    const businessRole = (req as { businessRole?: string }).businessRole;
    const body = req.body ?? {};

    if (
      businessRole === "admin" &&
      (body.quota != null || body.commission != null)
    ) {
      return res.status(403).json({
        error: "Only the workspace owner can edit rider daily goals.",
      });
    }

    try {
      const oldRider = await RiderService.getRider(businessId, id);
      await RiderService.updateRider(businessId, id, body);

      await logAuditEvent(
        "RIDER_UPDATED",
        {
          businessId,
          userId: user.uid,
          riderId: id,
        },
        oldRider,
        req.body,
      );

      if (oldRider?.name) {
        void notifyRiderProfileUpdated(
          businessId,
          id,
          oldRider.name,
          user.uid,
        ).catch((err) => logger.warn("notifyRiderProfileUpdated failed", err));
      }

      res.json({ success: true });
    } catch (error) {
      logger.error("Error updating rider", error);
      res.status(500).json({ error: "Failed to update rider" });
    }
  },

  async postRiderLocation(req: Request, res: Response) {
    const { businessId, id: riderId } = req.params;
    const user = (req as any).user;
    const businessRole = (req as any).businessRole || "member";
    const { latitude, longitude, accuracy, heading } = req.body || {};
    try {
      const lastLocation = await RiderTrackingService.updateRiderLocation(
        businessId,
        riderId,
        user.uid,
        businessRole,
        { latitude, longitude, accuracy, heading },
      );
      res.json({ data: { lastLocation } });
    } catch (e: any) {
      if (e?.message === "INVALID_COORDINATES") {
        return res.status(400).json({ error: "Invalid coordinates" });
      }
      if (e?.message === "RIDER_NOT_FOUND") {
        return res.status(404).json({ error: "Rider not found" });
      }
      if (e?.message === "FORBIDDEN") {
        return res.status(403).json({ error: "Forbidden" });
      }
      logger.error("Error posting rider location", e);
      res.status(500).json({ error: "Failed to update rider location" });
    }
  },

  async deleteRider(req: Request, res: Response) {
    const { businessId, id } = req.params;
    const user = (req as any).user;
    try {
      const oldRider = await RiderService.getRider(businessId, id);
      await RiderService.deleteRider(businessId, id);

      await logAuditEvent(
        "RIDER_DELETED",
        {
          businessId,
          userId: user.uid,
          riderId: id,
        },
        oldRider,
        null,
      );

      await notifyBusinessMembers(businessId, {
        title: "Rider removed",
        message: `${oldRider?.name || "A rider"} was removed from your team.`,
        type: "warning",
        metadata: { reviewTab: "operations", category: "rider", riderId: id },
      });

      res.json({ success: true });
    } catch (error) {
      logger.error("Error deleting rider", error);
      res.status(500).json({ error: "Failed to delete rider" });
    }
  },
};
