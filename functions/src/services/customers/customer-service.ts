import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import {
  applyCustomerLocationPatch,
  resolveCustomerLocationForWrite,
} from "./customer-location";
import {
  normalizeCustomerContainerPolicy,
  type CustomerContainerPolicy,
} from "./container-policy";

export interface Customer {
  id?: string;
  businessId: string;

  // Identity
  name: string;
  type: "residential" | "commercial";
  companyName?: string;
  photoUrl?: string;

  // Contact & Location
  email?: string;
  /** Opt-in from portal track completion for order email updates. */
  portalEmailNotifications?: boolean;
  /** NT-35 / NT-36 — SMS transaction status updates. */
  portalSmsOptIn?: boolean;
  /** NT-34 / NT-35 — Web Push on portal track page. */
  portalWebPushEnabled?: boolean;
  portalWebPushTokens?: string[];
  phone: string;
  address: string;
  latitude?: number;
  longitude?: number;

  // Pricing Configuration (waterTypeId -> customPrice)
  pricing?: Record<string, number>;
  /** Preferred water type label or id (portal, community, CRM). */
  preferredWaterType?: string;

  // Inventory/Possession (Physical assets in customer possession)
  // Maps itemIds (from inventory) to their quantities
  possession?: Record<
    string,
    {
      itemName: string;
      quantity: number;
    }
  >;

  /** WRS rotation vs own gallon; unspecified inherits station default. */
  containerPolicy?: CustomerContainerPolicy;

  /** Accepted container custody agreement (WRS rotation customers). */
  containerCustodyAgreement?: {
    status: "accepted";
    versionId: string;
    acceptedAt: string;
    channel: "crm" | "portal";
  };

  /** Refundable WRS container deposit (separate from water balance). */
  containerDeposit?: {
    balance: number;
    shellsCovered: number;
    updatedAt: string;
  };

  // Logistics
  isDeliveryEnabled: boolean;
  isCollectionEnabled: boolean;
  deliveryConfig?: {
    frequency: "daily" | "weekly" | "monthly" | "custom";
    preferredDays?: number[]; // 1-7 for Mon-Sun
    preferredTime?: string;
    repeatInterval?: number;
    repeatUnit?: "days" | "weeks" | "months";
    repeatDayOfMonth?: number;
  };
  collectionConfig?: {
    frequency: "daily" | "weekly" | "monthly" | "custom";
    preferredDays?: number[];
    preferredTime?: string;
    repeatInterval?: number;
    repeatUnit?: "days" | "weeks" | "months";
    repeatDayOfMonth?: number;
  };

  // Meta
  status: "active" | "inactive";
  hasBalance?: boolean;
  /** Public portal QR (rotates on profile updates). */
  qrToken?: string;
  /** Absolute URL to PNG QR image (API route). */
  qrCodeUrl?: string;
  /** Full portal URL encoded in the QR. */
  portalDeepLink?: string;
  /** ISO timestamp of last QR rotation / profile QR lifecycle update. */
  lastUpdated?: string;
  lastOrderAt?: any;
  /** Denormalized: latest fulfilled delivery/collection/walk-in/direct sale. */
  lastFulfilledAt?: any;
  lastFulfilledType?: "delivery" | "collection" | "walkin" | "direct_sale";
  /** ISO timestamp when owner logged a payment reminder call (BL-39). */
  lastRemindedAt?: any;
  /** ISO timestamp — hide suki from dormant win-back until this date (BL-12). */
  dormantSnoozeUntil?: any;
  /** Optional owner note for dormant snooze. */
  dormantSnoozeReason?: string;
  /** Optional referrer suki when this profile was word-of-mouth (BL-43). */
  referredByCustomerId?: string;
  createdAt?: any;
  updatedAt?: any;
}

/**
 * Service for managing customers within a business.
 */
export class CustomerService {
  /**
   * Retrieves a single customer from a business subcollection.
   * @param {string} businessId The business ID.
   * @param {string} customerId The customer ID.
   */
  static async getCustomer(
    businessId: string,
    customerId: string,
  ): Promise<Customer | null> {
    try {
      const doc = await db
        .collection("businesses")
        .doc(businessId)
        .collection("customers")
        .doc(customerId)
        .get();
      if (!doc.exists) return null;
      return { id: doc.id, ...doc.data() } as Customer;
    } catch (error) {
      logger.error(`Error getting customer ${customerId}`, error);
      throw error;
    }
  }

  /**
   * Retrieves all customers for a specific business.
   * @param {string} businessId The business ID.
   */
  static async getCustomersByBusiness(businessId: string): Promise<Customer[]> {
    try {
      const snapshot = await db
        .collection("businesses")
        .doc(businessId)
        .collection("customers")
        .orderBy("createdAt", "desc")
        .get();

      return snapshot.docs.map((doc: any) => ({
        id: doc.id,
        ...doc.data(),
      })) as Customer[];
    } catch (error) {
      logger.error(
        `Error fetching customers for business ${businessId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Adds a new customer to a business subcollection.
   * @param {string} businessId The business ID.
   * @param {Partial<Customer>} customer The customer data.
   */
  static async addCustomer(
    businessId: string,
    customer: Partial<Customer>,
  ): Promise<Customer> {
    try {
      const location = resolveCustomerLocationForWrite({
        address: customer.address,
        latitude: customer.latitude,
        longitude: customer.longitude,
      });

      const newCustomer: Customer = {
        businessId,
        name: customer.name || "Untitled Suki",
        type: customer.type || "residential",
        companyName: customer.companyName,
        photoUrl: customer.photoUrl,
        email: customer.email,
        phone: customer.phone || "",
        address: location.address,
        pricing: customer.pricing || {},
        possession: customer.possession || {},
        containerPolicy: normalizeCustomerContainerPolicy(
          customer.containerPolicy,
        ),
        isDeliveryEnabled: !!customer.isDeliveryEnabled,
        isCollectionEnabled: !!customer.isCollectionEnabled,
        deliveryConfig: customer.isDeliveryEnabled ?
          customer.deliveryConfig || { frequency: "weekly" } :
          undefined,
        collectionConfig: customer.isCollectionEnabled ?
          customer.collectionConfig || { frequency: "weekly" } :
          undefined,
        status: "active",
        hasBalance: false,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (location.latitude != null && location.longitude != null) {
        newCustomer.latitude = location.latitude;
        newCustomer.longitude = location.longitude;
      }

      const docRef = await db
        .collection("businesses")
        .doc(businessId)
        .collection("customers")
        .add(newCustomer);
      return { id: docRef.id, ...newCustomer };
    } catch (error) {
      logger.error("Error adding customer", error);
      throw error;
    }
  }

  /**
   * Updates an existing customer in a business subcollection.
   * @param {string} businessId The business ID.
   * @param {string} customerId The customer ID.
   * @param {Partial<Customer>} updates The updates.
   */
  static async updateCustomer(
    businessId: string,
    customerId: string,
    updates: Partial<Customer>,
  ): Promise<void> {
    try {
      const docRef = db
        .collection("businesses")
        .doc(businessId)
        .collection("customers")
        .doc(customerId);
      await docRef.update(
        applyCustomerLocationPatch({
          ...updates,
          updatedAt: FieldValue.serverTimestamp(),
        }),
      );
    } catch (error) {
      logger.error(`Error updating customer ${customerId}`, error);
      throw error;
    }
  }

  /**
   * Deletes a customer from a business subcollection.
   * @param {string} businessId The business ID.
   * @param {string} customerId The customer ID.
   */
  static async deleteCustomer(
    businessId: string,
    customerId: string,
  ): Promise<void> {
    try {
      await db
        .collection("businesses")
        .doc(businessId)
        .collection("customers")
        .doc(customerId)
        .delete();
    } catch (error) {
      logger.error(`Error deleting customer ${customerId}`, error);
      throw error;
    }
  }

  /**
   * Gets aggregated statistics for all customers in a business.
   * @param {string} businessId The business ID.
   */
  static async getCustomerStats(businessId: string): Promise<{
    total: number;
    activeThisMonth: number;
    newThisMonth: number;
    customersWithBalance: number;
  }> {
    try {
      const snapshot = await db
        .collection("businesses")
        .doc(businessId)
        .collection("customers")
        .get();

      const now = new Date();
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      let total = 0;
      let activeThisMonth = 0;
      let newThisMonth = 0;
      let customersWithBalance = 0;

      snapshot.forEach((doc: any) => {
        const data = doc.data() as Customer;
        total++;

        if (data.status === "active") {
          activeThisMonth++;
        }

        if (data.hasBalance) {
          customersWithBalance++;
        }

        if (data.createdAt) {
          const createdAt = data.createdAt.toDate ?
            data.createdAt.toDate() :
            new Date(data.createdAt);
          if (createdAt >= firstDayOfMonth) {
            newThisMonth++;
          }
        }
      });

      return {
        total,
        activeThisMonth,
        newThisMonth,
        customersWithBalance,
      };
    } catch (error) {
      logger.error("Error getting customer stats", error);
      throw error;
    }
  }

  /**
   * Gets aggregated statistics for a specific customer.
   * @param {string} businessId The business ID.
   * @param {string} customerId The customer ID.
   */
  static async getSingleCustomerStats(
    businessId: string,
    customerId: string,
  ): Promise<{
    totalRevenue: number;
    balanceDue: number;
    totalOrders: number;
    lastOrderAt: any;
    tenure: string;
  }> {
    try {
      const customer = await this.getCustomer(businessId, customerId);
      if (!customer) throw new Error("Customer not found");

      const transactionsSnapshot = await db
        .collection("businesses")
        .doc(businessId)
        .collection("transactions")
        .where("customerId", "==", customerId)
        .get();

      let totalRevenue = 0;
      let balanceDue = 0;
      let totalOrders = 0;
      let lastOrderAt: Date | null = null;

      transactionsSnapshot.forEach((doc: any) => {
        const data = doc.data();
        if (data.type !== "expense") {
          totalOrders++;
          totalRevenue += data.totalAmount || 0;
          balanceDue += data.balanceDue || 0;

          const scheduledAt = data.scheduledAt?.toDate ?
            data.scheduledAt.toDate() :
            new Date(data.scheduledAt);
          if (!lastOrderAt || scheduledAt > lastOrderAt) {
            lastOrderAt = scheduledAt;
          }
        }
      });

      return {
        totalRevenue,
        balanceDue,
        totalOrders,
        lastOrderAt,
        tenure: customer.createdAt ?
          customer.createdAt.toDate ?
            customer.createdAt.toDate() :
            new Date(customer.createdAt) :
          "New Suki",
      };
    } catch (error) {
      logger.error(`Error getting stats for customer ${customerId}`, error);
      throw error;
    }
  }
}
