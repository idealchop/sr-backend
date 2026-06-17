import { Request, Response } from "express";
import { DeliveryService } from "../../services/deliveries/delivery-service";
import { SharedRouteService } from "../../services/deliveries/shared-route-service";
import { RiderService } from "../../services/riders/rider-service";
import {
  logger,
  logAuditEvent,
} from "../../services/observability/logging/logger";
import {
  notifyBusinessMembers,
} from "../../services/notifications/station-activity-notification-service";
import { CustomerService } from "../../services/customers/customer-service";

export const deliveryHandler = {
  /**
   * GET /business/:businessId/deliveries — lists all deliveries
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async listDeliveries(req: Request, res: Response) {
    try {
      const { businessId } = req.params;
      const deliveries = await DeliveryService.getAllDeliveries(businessId);
      res.json({ data: deliveries });
    } catch (error) {
      logger.error("Error listing all deliveries", error);
      res.status(500).json({ error: "Failed to list deliveries" });
    }
  },

  /**
   * GET /business/:businessId/deliveries/active — lists active deliveries
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async listActive(req: Request, res: Response) {
    try {
      const { businessId } = req.params;
      const deliveries = await DeliveryService.getActiveDeliveries(businessId);
      res.json({ data: deliveries });
    } catch (error) {
      logger.error("Error listing active deliveries", error);
      res.status(500).json({ error: "Failed to list deliveries" });
    }
  },

  /**
   * GET /business/:businessId/deliveries/:id — gets a single delivery
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async getDelivery(req: Request, res: Response) {
    try {
      const { businessId, id } = req.params;
      const delivery = await DeliveryService.getDelivery(businessId, id);
      if (!delivery) {
        return res.status(404).json({ error: "Delivery not found" });
      }
      res.json({ data: delivery });
    } catch (error) {
      logger.error("Error getting delivery", error);
      res.status(500).json({ error: "Failed to get delivery" });
    }
  },

  /**
   * POST /business/:businessId/deliveries — creates a new delivery
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async createDelivery(req: Request, res: Response) {
    const { businessId } = req.params;
    const user = (req as any).user;
    try {
      const delivery = await DeliveryService.createDelivery(
        businessId,
        req.body,
      );

      await logAuditEvent(
        "DELIVERY_CREATED",
        {
          businessId,
          userId: user.uid,
          deliveryId: delivery.id,
        },
        null,
        req.body,
      );

      const customerName =
        (typeof req.body.customerName === "string" && req.body.customerName.trim()) ||
        "Customer";
      await notifyBusinessMembers(businessId, {
        title: "New delivery scheduled",
        message: `Delivery scheduled for ${customerName}.`,
        type: "info",
        metadata: {
          reviewTab: "transactions",
          category: "delivery",
          deliveryId: delivery.id,
          customerId: req.body.customerId,
        },
      });

      res.status(201).json(delivery);
    } catch (error) {
      logger.error("Error creating delivery", error);
      res.status(500).json({ error: "Failed to create delivery" });
    }
  },

  /**
   * POST /business/:businessId/deliveries/:id/assign — assigns a rider
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async assignRider(req: Request, res: Response) {
    const { businessId, id } = req.params;
    const { riderId } = req.body;
    try {
      if (!riderId) {
        return res.status(400).json({ error: "Rider ID is required" });
      }

      await DeliveryService.assignRider(businessId, id, riderId);

      const delivery = await DeliveryService.getDelivery(businessId, id);
      const rider = await RiderService.getRider(businessId, riderId);
      let customerName = "Customer";
      if (delivery?.customerId) {
        const customer = await CustomerService.getCustomer(
          businessId,
          delivery.customerId,
        );
        customerName = customer?.name?.trim() || customerName;
      }

      if (rider?.userId) {
        const { NotificationService } = await import(
          "../../services/notifications/notification-service"
        );
        await NotificationService.send({
          userId: rider.userId,
          businessId,
          title: "Delivery assigned to you",
          message: `${customerName} was added to your route.`,
          type: "info",
          metadata: {
            reviewTab: "transactions",
            category: "delivery",
            deliveryId: id,
            riderId,
          },
        });
      }

      await notifyBusinessMembers(businessId, {
        title: "Rider assigned",
        message: `${rider?.name || "Rider"} assigned to ${customerName}.`,
        type: "info",
        metadata: {
          reviewTab: "transactions",
          category: "delivery",
          deliveryId: id,
          riderId,
        },
      });

      res.json({ success: true });
    } catch (error) {
      logger.error("Error assigning rider", error);
      res.status(500).json({ error: "Failed to assign rider" });
    }
  },

  /**
   * POST /business/:businessId/deliveries/:id/complete — completes a delivery
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async completeDelivery(req: Request, res: Response) {
    const { businessId, id } = req.params;
    const { containerMovements, signatureUrl } = req.body;
    try {
      await DeliveryService.completeDelivery(
        businessId,
        id,
        containerMovements || [],
        signatureUrl,
      );

      res.json({ success: true });
    } catch (error) {
      logger.error("Error completing delivery", error);
      res.status(500).json({ error: "Failed to complete delivery" });
    }
  },

  /**
   * POST /business/:businessId/deliveries/share — shares a route with a rider
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async shareRoute(req: Request, res: Response) {
    const { businessId } = req.params;
    const user = (req as any).user;
    try {
      const id = await SharedRouteService.createSharedRoute(
        businessId,
        user.uid,
        req.body,
      );

      await logAuditEvent(
        "ROUTE_SHARED",
        {
          businessId,
          userId: user.uid,
          sharedRouteId: id,
        },
        null,
        req.body,
      );

      res.status(201).json({ id });
    } catch (error) {
      logger.error("Error sharing route", error);
      res.status(500).json({ error: "Failed to share route" });
    }
  },

  /**
   * GET /deliveries/shared/:id — gets a shared route (public)
   * @param {Request} req Express request
   * @param {Response} res Express response
   */
  async getSharedRoute(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const route = await SharedRouteService.getSharedRoute(id);
      if (!route) {
        return res.status(404).json({ error: "Shared route not found" });
      }
      res.json({ data: route });
    } catch (error) {
      logger.error(`Error getting shared route ${req.params.id}`, error);
      res.status(500).json({ error: "Failed to get shared route" });
    }
  },
};
