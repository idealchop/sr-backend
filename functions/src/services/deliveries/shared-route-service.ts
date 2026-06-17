import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";
import { RiderTrackingService } from "../riders/rider-tracking-service";

function serializeTimestamp(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null && "_seconds" in value) {
    const sec = (value as { _seconds: number })._seconds;
    return new Date(sec * 1000).toISOString();
  }
  if (typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

export interface SharedRoute {
  id?: string;
  businessProfile: {
    businessName: string;
    stationAddress: string;
    logo?: string;
    phone?: string;
    email?: string;
    latitude?: number;
    longitude?: number;
  };
  riderId?: string;
  riderName?: string;
  riderLocation?: {
    latitude: number;
    longitude: number;
    updatedAt?: string | null;
  } | null;
  deliveries: Array<{
    id: string;
    name: string;
    address: string;
    latitude: number | null;
    longitude: number | null;
    status: string;
    bottles: number;
    arrivedAt?: string | null;
    deliveredAt?: string | null;
    notes?: string;
    phone?: string;
    date: string;
    nearbySuki?: Array<{
      id: string;
      name: string;
      distance: number;
      latitude: number;
      longitude: number;
    }>;
  }>;
  sharedAt: any;
  ownerId?: string;
  businessId: string;
}

export class SharedRouteService {
  /**
   * Creates a public shared route record.
   * @param {string} businessId The business ID.
   * @param {string} ownerId The user ID who shared the route.
   * @param {Partial<SharedRoute>} data The route data.
   */
  static async createSharedRoute(
    businessId: string,
    ownerId: string,
    data: Partial<SharedRoute>,
  ): Promise<string> {
    try {
      const payload = {
        ...data,
        businessId,
        ownerId,
        sharedAt: FieldValue.serverTimestamp(),
      };

      const docRef = await db.collection("deliveryTrackers").add(payload);
      return docRef.id;
    } catch (error) {
      logger.error("Error creating shared route", error);
      throw error;
    }
  }

  /**
   * Gets a shared route by its public ID.
   * @param {string} id The public record ID.
   */
  static async getSharedRoute(id: string): Promise<SharedRoute | null> {
    try {
      const doc = await db.collection("deliveryTrackers").doc(id).get();
      if (!doc.exists) return null;
      const base = { id: doc.id, ...doc.data() } as SharedRoute;
      const businessId = base.businessId;
      const riderId = base.riderId;

      let riderLocation: SharedRoute["riderLocation"] = null;
      if (businessId && riderId) {
        const loc = await RiderTrackingService.getRiderLastLocation(
          businessId,
          riderId,
        );
        if (loc) {
          riderLocation = {
            latitude: loc.latitude,
            longitude: loc.longitude,
            updatedAt: serializeTimestamp(loc.updatedAt),
          };
        }
      }

      const deliveries = await Promise.all(
        (base.deliveries || []).map(async (stop) => {
          if (!businessId || !stop.id) return stop;
          try {
            const txSnap = await db
              .collection("businesses")
              .doc(businessId)
              .collection("transactions")
              .doc(stop.id)
              .get();
            if (!txSnap.exists) return stop;
            const tx = txSnap.data();
            return {
              ...stop,
              status: String(tx?.deliveryStatus || stop.status),
              arrivedAt: serializeTimestamp(tx?.arrivedAt),
              deliveredAt: serializeTimestamp(tx?.deliveredAt),
            };
          } catch {
            return stop;
          }
        }),
      );

      return {
        ...base,
        riderLocation,
        deliveries,
      };
    } catch (error) {
      logger.error(`Error fetching shared route ${id}`, error);
      throw error;
    }
  }
}
