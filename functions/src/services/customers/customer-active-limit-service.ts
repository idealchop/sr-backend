import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { SubscriptionService } from "../subscriptions/subscription-service";
import { parsePlanLimitations } from "../../utils/subscription-addon-plan-limits";
import { notifyBusinessMembers } from "../notifications/station-activity-notification-service";
import { Customer, CustomerService } from "./customer-service";

export class CustomerActiveLimitError extends Error {
  code = "CUSTOMER_ACTIVE_LIMIT_EXCEEDED";

  constructor(
    message: string,
    public readonly activeCount: number,
    public readonly cap: number,
  ) {
    super(message);
    this.name = "CustomerActiveLimitError";
  }
}

/**
 * Active for quota purposes (missing/legacy status counts as active).
 * @param {string | undefined} status Customer status field.
 * @return {boolean} True when the customer counts toward the active cap.
 */
export function isCustomerActiveForLimit(
  status: string | undefined,
): boolean {
  return status !== "inactive";
}

export function countActiveCustomers(customers: Customer[]): number {
  return customers.filter((c) => isCustomerActiveForLimit(c.status)).length;
}

/**
 * Plan cap for concurrently active sukis (`customersMax`); null = unlimited.
 */
export class CustomerActiveLimitService {
  static async resolveActiveCustomerCap(
    businessId: string,
  ): Promise<number | null> {
    const sub = await SubscriptionService.getSubscriptionStatus(businessId);
    const planCode = String((sub as { planCode?: string }).planCode || "starter");
    const planRow = await SubscriptionService.lookupPlanRowForCode(planCode);
    const quotas = parsePlanLimitations(planRow?.planData?.limitations);
    return quotas?.customersMax ?? null;
  }

  static async getActiveCustomerCount(businessId: string): Promise<number> {
    const customers = await CustomerService.getCustomersByBusiness(businessId);
    return countActiveCustomers(customers);
  }

  static async assertCanAddActiveCustomer(businessId: string): Promise<void> {
    const cap = await this.resolveActiveCustomerCap(businessId);
    if (cap === null || cap <= 0) return;

    const activeCount = await this.getActiveCustomerCount(businessId);
    if (activeCount >= cap) {
      throw new CustomerActiveLimitError(
        `Your plan allows ${cap} active sukis. Deactivate another suki or upgrade your plan.`,
        activeCount,
        cap,
      );
    }
  }

  static async assertCanActivateCustomer(businessId: string): Promise<void> {
    await this.assertCanAddActiveCustomer(businessId);
  }

  /**
   * After a plan downgrade: if active sukis exceed the new cap, set all active sukis inactive.
   * @param {string} businessId Business id.
   * @param {number | null} cap Max active sukis from plan; null skips enforcement.
   * @return {Promise<number>} Count of customers deactivated.
   */
  static async applyPlanDowngradeActivePolicy(
    businessId: string,
    cap: number | null,
  ): Promise<number> {
    if (cap === null || cap <= 0) return 0;

    const customers = await CustomerService.getCustomersByBusiness(businessId);
    const active = customers.filter((c) => isCustomerActiveForLimit(c.status));
    if (active.length <= cap) return 0;

    const toDeactivate = active.filter((c) => c.id);
    const chunkSize = 400;
    for (let i = 0; i < toDeactivate.length; i += chunkSize) {
      const chunk = toDeactivate.slice(i, i + chunkSize);
      const batch = db.batch();
      for (const customer of chunk) {
        const customerId = customer.id;
        if (!customerId) continue;
        const ref = db
          .collection("businesses")
          .doc(businessId)
          .collection("customers")
          .doc(customerId);
        batch.update(ref, {
          status: "inactive",
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }
    const count = toDeactivate.length;

    if (count > 0) {
      logger.info(
        `Deactivated ${count} active customers for business ${businessId} (plan cap ${cap})`,
      );
      await notifyBusinessMembers(businessId, {
        title: "Suki status updated for your plan",
        message:
          `${count} active suki${count === 1 ? "" : "s"} were set to inactive because your plan ` +
          `allows ${cap} active suki${cap === 1 ? "" : "s"} at a time. You can reactivate up to ` +
          `${cap} from your suki list.`,
        type: "warning",
        metadata: { reviewTab: "customers", category: "customer" },
      });
    }

    return count;
  }

  static async applyPlanDowngradeActivePolicyForBusiness(
    businessId: string,
  ): Promise<number> {
    const cap = await this.resolveActiveCustomerCap(businessId);
    return this.applyPlanDowngradeActivePolicy(businessId, cap);
  }
}
