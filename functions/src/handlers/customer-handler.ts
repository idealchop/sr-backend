import { Request, Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../config/firebase-admin";
import {
  CustomerActiveLimitError,
  CustomerActiveLimitService,
} from "../services/customers/customer-active-limit-service";
import { CustomerService } from "../services/customers/customer-service";
import {
  applyCustomerPossessionStockDelta,
  CustomerPossessionMap,
  InsufficientStockError,
} from "../services/customers/customer-possession-stock";
import { normalizeCustomerContainerDeposit } from "../services/customers/container-deposit";
import {
  customerUsesWrContainerRotation,
  getBusinessContainerDefaultPolicy,
} from "../services/customers/container-policy";
import {
  notifyBusinessMembers,
  notifyCustomerProfileUpdated,
  notifyCustomerRemoved,
} from "../services/notifications/station-activity-notification-service";
import {
  logAuditEvent,
  logger,
} from "../services/observability/logging/logger";
import {
  claimNearbyDormantForRider,
  ClaimNearbyDormantError,
} from "../services/transactions/claim-nearby-dormant-service";

function possessionStockErrorResponse(res: Response, error: unknown) {
  if (error instanceof InsufficientStockError) {
    return res.status(400).json({
      error: "INSUFFICIENT_STOCK",
      message: error.message,
      items: error.items,
    });
  }
  logger.error("Customer possession stock sync failed", error);
  return res.status(500).json({
    error: "STOCK_SYNC_FAILED",
    message: "Could not update inventory for assigned containers.",
  });
}

async function shouldApplyCustomerPossessionStock(
  businessId: string,
  customer: { containerPolicy?: unknown } | null | undefined,
): Promise<boolean> {
  const businessSnap = await db.collection("businesses").doc(businessId).get();
  const businessDefault = getBusinessContainerDefaultPolicy(
    businessSnap.data() as Record<string, unknown> | undefined,
  );
  return customerUsesWrContainerRotation(customer, businessDefault);
}

export const listCustomers = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  try {
    const customers = await CustomerService.getCustomersByBusiness(businessId);
    res.json({ data: customers });
  } catch (error) {
    logger.error("Error listing customers", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getCustomer = async (req: Request, res: Response) => {
  const { businessId, customerId } = req.params;
  try {
    const customer = await CustomerService.getCustomer(businessId, customerId);
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    res.json({ data: customer });
  } catch (error) {
    logger.error("Error getting customer", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getCustomerStats = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  try {
    const stats = await CustomerService.getCustomerStats(businessId);
    res.json({ data: stats });
  } catch (error) {
    logger.error("Error getting customer stats", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
export const getSingleCustomerStats = async (req: Request, res: Response) => {
  const { businessId, customerId } = req.params;
  try {
    const stats = await CustomerService.getSingleCustomerStats(
      businessId,
      customerId,
    );
    res.json({ data: stats });
  } catch (error) {
    logger.error(`Error getting stats for customer ${customerId}`, error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const addCustomer = async (req: Request, res: Response) => {
  const { businessId } = req.params;
  const user = (req as any).user;
  try {
    const requestedStatus = req.body?.status as string | undefined;
    const willBeActive =
      requestedStatus === undefined || requestedStatus !== "inactive";
    if (willBeActive) {
      try {
        await CustomerActiveLimitService.assertCanAddActiveCustomer(businessId);
      } catch (limitErr) {
        if (limitErr instanceof CustomerActiveLimitError) {
          return res.status(403).json({
            error: limitErr.code,
            message: limitErr.message,
            activeCount: limitErr.activeCount,
            cap: limitErr.cap,
          });
        }
        throw limitErr;
      }
    }

    const customer = await CustomerService.addCustomer(businessId, req.body);

    const created = customer.id ?
      await CustomerService.getCustomer(businessId, customer.id) :
      customer;

    if (req.body.possession && customer.id) {
      const applyStock = await shouldApplyCustomerPossessionStock(
        businessId,
        { containerPolicy: req.body.containerPolicy },
      );
      if (applyStock) {
        try {
          await applyCustomerPossessionStockDelta(
            businessId,
            {},
            req.body.possession as CustomerPossessionMap,
            {
              customerId: customer.id,
              customerName: customer.name,
              userId: user.uid,
              reason: "CUSTOMER_ONBOARDING_WRS_ASSIGNMENT",
            },
          );
        } catch (invErr) {
          try {
            await CustomerService.deleteCustomer(businessId, customer.id);
          } catch (rollbackErr) {
            logger.error(
              "Failed to roll back customer after stock deduction failure",
              rollbackErr,
            );
          }
          return possessionStockErrorResponse(res, invErr);
        }
      }
    }

    await logAuditEvent(
      "CUSTOMER_ADDED",
      {
        businessId,
        userId: user.uid,
        customerId: customer.id,
      },
      null,
      req.body,
    );

    await notifyBusinessMembers(businessId, {
      title: "New customer registered",
      message: `${customer.name} was added to your suki list.`,
      type: "success",
      metadata: {
        reviewTab: "customers",
        category: "customer",
        customerId: customer.id,
      },
    });

    res.status(201).json({ data: created || customer });
  } catch (error) {
    logger.error("Error adding customer", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const updateCustomer = async (req: Request, res: Response) => {
  const { businessId, customerId } = req.params;
  const user = (req as any).user;
  try {
    const oldCustomer = await CustomerService.getCustomer(
      businessId,
      customerId,
    );
    const safeBody = { ...(req.body || {}) };
    delete (safeBody as any).qrToken;
    delete (safeBody as any).qrCodeUrl;
    delete (safeBody as any).portalDeepLink;
    delete (safeBody as any).lastUpdated;
    delete (safeBody as any).containerCustodyAgreement;

    if (safeBody.dormantSnoozeUntil === null) {
      (safeBody as any).dormantSnoozeUntil = FieldValue.delete();
    }
    if (safeBody.dormantSnoozeReason === null) {
      (safeBody as any).dormantSnoozeReason = FieldValue.delete();
    }
    if (safeBody.referredByCustomerId === null) {
      (safeBody as any).referredByCustomerId = FieldValue.delete();
    }

    if (safeBody.containerDeposit !== undefined) {
      if (safeBody.containerDeposit === null) {
        (safeBody as any).containerDeposit = FieldValue.delete();
      } else {
        const normalized = normalizeCustomerContainerDeposit({
          ...(safeBody.containerDeposit as Record<string, unknown>),
          updatedAt: new Date().toISOString(),
        });
        if (!normalized) {
          return res.status(400).json({ error: "Invalid container deposit." });
        }
        safeBody.containerDeposit = normalized;
      }
    }

    if (
      safeBody.status === "active" &&
      oldCustomer &&
      oldCustomer.status === "inactive"
    ) {
      try {
        await CustomerActiveLimitService.assertCanActivateCustomer(businessId);
      } catch (limitErr) {
        if (limitErr instanceof CustomerActiveLimitError) {
          return res.status(403).json({
            error: limitErr.code,
            message: limitErr.message,
            activeCount: limitErr.activeCount,
            cap: limitErr.cap,
          });
        }
        throw limitErr;
      }
    }

    if (safeBody.possession !== undefined && oldCustomer) {
      const nextPolicy =
        safeBody.containerPolicy !== undefined ?
          safeBody.containerPolicy :
          oldCustomer.containerPolicy;
      const applyStock = await shouldApplyCustomerPossessionStock(
        businessId,
        { containerPolicy: nextPolicy },
      );
      if (applyStock) {
        try {
          await applyCustomerPossessionStockDelta(
            businessId,
            (oldCustomer.possession || {}) as CustomerPossessionMap,
            safeBody.possession as CustomerPossessionMap,
            {
              customerId,
              customerName: oldCustomer.name,
              userId: user.uid,
              reason: "CUSTOMER_POSSESSION_UPDATE",
            },
          );
        } catch (invErr) {
          return possessionStockErrorResponse(res, invErr);
        }
      }
    }

    await CustomerService.updateCustomer(businessId, customerId, safeBody);

    await logAuditEvent(
      "CUSTOMER_UPDATED",
      {
        businessId,
        userId: user.uid,
        customerId,
      },
      oldCustomer,
      safeBody,
    );

    const changeBits: string[] = [];
    if (safeBody.status && safeBody.status !== oldCustomer?.status) {
      changeBits.push(`status → ${safeBody.status}`);
    }
    if (safeBody.name && safeBody.name !== oldCustomer?.name) {
      changeBits.push("name updated");
    }
    if (safeBody.phone && safeBody.phone !== oldCustomer?.phone) {
      changeBits.push("phone updated");
    }
    if (safeBody.possession !== undefined) {
      changeBits.push("containers adjusted");
    }
    if (changeBits.length > 0) {
      void notifyCustomerProfileUpdated(
        businessId,
        customerId,
        oldCustomer?.name || String(safeBody.name || "Customer"),
        user.uid,
        changeBits.join(", "),
      ).catch((err) => logger.warn("notifyCustomerProfileUpdated failed", err));
    }

    res.json({ success: true });
  } catch (error) {
    logger.error("Error updating customer", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const deleteCustomer = async (req: Request, res: Response) => {
  const { businessId, customerId } = req.params;
  const user = (req as any).user;
  try {
    const oldCustomer = await CustomerService.getCustomer(
      businessId,
      customerId,
    );

    if (oldCustomer?.possession) {
      const applyStock = await shouldApplyCustomerPossessionStock(
        businessId,
        oldCustomer,
      );
      if (applyStock) {
        try {
          await applyCustomerPossessionStockDelta(
            businessId,
            oldCustomer.possession as CustomerPossessionMap,
            {},
            {
              customerId,
              customerName: oldCustomer.name,
              userId: user.uid,
              reason: "CUSTOMER_DELETED_STOCK_RESTORATION",
            },
          );
        } catch (invErr) {
          return possessionStockErrorResponse(res, invErr);
        }
      }
    }

    await CustomerService.deleteCustomer(businessId, customerId);

    await logAuditEvent(
      "CUSTOMER_DELETED",
      {
        businessId,
        userId: user.uid,
        customerId,
      },
      oldCustomer,
      null,
    );

    await notifyCustomerRemoved(
      businessId,
      customerId,
      oldCustomer?.name || "A customer",
      user.uid,
    );

    res.json({ success: true });
  } catch (error) {
    logger.error("Error deleting customer", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const claimNearbyDormantCustomer = async (req: Request, res: Response) => {
  const { businessId, customerId } = req.params;
  const user = (req as { user?: { uid: string } }).user;
  const businessRole = (req as { businessRole?: string }).businessRole;
  const riderLat = Number(req.body?.riderLat);
  const riderLng = Number(req.body?.riderLng);

  if (!user?.uid) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await claimNearbyDormantForRider({
      businessId,
      customerId,
      claimerUid: user.uid,
      claimerBusinessRole: businessRole || "member",
      riderLat,
      riderLng,
    });
    res.status(201).json({ data: result });
  } catch (error: unknown) {
    if (error instanceof ClaimNearbyDormantError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    logger.error("Error claiming nearby dormant customer", error);
    res.status(500).json({ error: "Failed to add quiet nearby suki to route" });
  }
};
