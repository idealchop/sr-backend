import {
  CustomerActiveLimitError,
  CustomerActiveLimitService,
  isCustomerActiveForLimit,
} from "../customers/customer-active-limit-service";
import { Customer, CustomerService } from "../customers/customer-service";

export class PortalCustomerActivationBlockedError extends Error {
  code = "PORTAL_CUSTOMER_ACTIVATION_BLOCKED";

  constructor(
    message = "Upgrade your plan to accept this order. Your active suki limit is full.",
    public readonly activeCount?: number,
    public readonly cap?: number,
  ) {
    super(message);
    this.name = "PortalCustomerActivationBlockedError";
  }
}

function toActivationBlocked(err: CustomerActiveLimitError): PortalCustomerActivationBlockedError {
  return new PortalCustomerActivationBlockedError(
    "Upgrade your plan to accept this order. Your active suki limit is full.",
    err.activeCount,
    err.cap,
  );
}

/**
 * Reactivates an inactive suki when accepting or linking a portal order.
 * @param {string} businessId Business id.
 * @param {Customer} customer Customer document.
 * @return {Promise<Customer>} Updated customer (or unchanged if already active).
 * @throws {PortalCustomerActivationBlockedError} when the plan active cap is full.
 */
export async function ensureCustomerActiveForPortalAcceptance(
  businessId: string,
  customer: Customer,
): Promise<Customer> {
  if (isCustomerActiveForLimit(customer.status)) return customer;
  if (!customer.id) throw new Error("CUSTOMER_ID_REQUIRED");

  try {
    await CustomerActiveLimitService.assertCanActivateCustomer(businessId);
  } catch (err) {
    if (err instanceof CustomerActiveLimitError) {
      throw toActivationBlocked(err);
    }
    throw err;
  }

  await CustomerService.updateCustomer(businessId, customer.id, { status: "active" });
  return { ...customer, status: "active" };
}
