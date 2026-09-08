import { Request, Response } from "express";
import { CustomerService } from "../../services/customers/customer-service";
import { applyPossessionFromFulfilledOrdersIfEmpty } from "../../services/customers/backfill-customer-possession-from-orders";
import { logger } from "../../services/observability/logging/logger";

export const syncPossessionFromOrders = async (
  req: Request,
  res: Response,
) => {
  const { businessId, customerId } = req.params;
  const user = (req as { user?: { uid?: string; name?: string } }).user;

  if (!businessId || !customerId) {
    return res.status(400).json({ error: "businessId and customerId are required" });
  }

  try {
    const customer = await CustomerService.getCustomer(businessId, customerId);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }
    if (customer.trackContainers !== true) {
      return res.status(400).json({
        error: "CONTAINERS_OFF",
        message: "Turn Containers on before filling held gallons from orders.",
      });
    }

    const result = await applyPossessionFromFulfilledOrdersIfEmpty({
      businessId,
      customerId,
      customer,
      userId: user?.uid,
      userName: user?.name,
    });

    return res.json({
      data: {
        applied: result.applied,
        possession: result.possession,
      },
    });
  } catch (error) {
    logger.error("syncPossessionFromOrders failed", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};
