import { Request, Response } from "express";
import { db } from "../../config/firebase-admin";
import { CustomerService } from "../../services/customers/customer-service";
import {
  businessHasActiveContainerCustodyAgreement,
  customerNeedsContainerCustodyAcceptance,
  stampCustomerContainerCustodyAcceptance,
} from "../../services/customers/container-custody-agreement";
import { logAuditEvent, logger } from "../../services/observability/logging/logger";

export const acceptContainerCustodyAgreement = async (
  req: Request,
  res: Response,
) => {
  const { businessId, customerId } = req.params;
  const user = (req as { user?: { uid?: string } }).user;

  if (!businessId || !customerId) {
    return res.status(400).json({ error: "businessId and customerId are required" });
  }

  try {
    const [businessSnap, customer] = await Promise.all([
      db.collection("businesses").doc(businessId).get(),
      CustomerService.getCustomer(businessId, customerId),
    ]);

    if (!businessSnap.exists) {
      return res.status(404).json({ error: "Business not found" });
    }
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const business = businessSnap.data() as Record<string, unknown>;
    if (!businessHasActiveContainerCustodyAgreement(business)) {
      return res.status(400).json({
        error: "CUSTODY_NOT_ENABLED",
        message: "Container custody agreement is not enabled for this station.",
      });
    }

    if (!customerNeedsContainerCustodyAcceptance(customer, business)) {
      return res.status(409).json({
        error: "CUSTODY_ALREADY_ACCEPTED",
        message: "Customer already accepted the current custody agreement.",
      });
    }

    const acceptance = await stampCustomerContainerCustodyAcceptance(
      businessId,
      customerId,
      "crm",
    );

    await logAuditEvent(
      "CUSTOMER_CUSTODY_ACCEPTED",
      {
        businessId,
        customerId,
        userId: user?.uid,
        versionId: acceptance.versionId,
        channel: "crm",
      },
      customer.containerCustodyAgreement ?? null,
      acceptance,
    );

    return res.json({ data: acceptance });
  } catch (error) {
    logger.error("acceptContainerCustodyAgreement failed", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};
