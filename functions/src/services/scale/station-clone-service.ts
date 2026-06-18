import { db, FieldValue } from "../../config/firebase-admin";
import { logger } from "../observability/logging/logger";

export type StationCloneOptions = {
  copyCatalog?: boolean;
  copyMaintenanceTemplates?: boolean;
  copyInventoryGroupings?: boolean;
  copyNotificationDefaults?: boolean;
  copySampleSukis?: boolean;
  targetBusinessName?: string;
};

export type StationCloneResult = {
  sourceBusinessId: string;
  targetBusinessId: string;
  copied: string[];
};

/**
 * SC-02 — clone station template to a new businessId (owner-only).
 */
export async function cloneStationTemplate(params: {
  sourceBusinessId: string;
  ownerId: string;
  options?: StationCloneOptions;
}): Promise<StationCloneResult> {
  const opts: Required<StationCloneOptions> = {
    copyCatalog: params.options?.copyCatalog !== false,
    copyMaintenanceTemplates: params.options?.copyMaintenanceTemplates !== false,
    copyInventoryGroupings: params.options?.copyInventoryGroupings !== false,
    copyNotificationDefaults: params.options?.copyNotificationDefaults !== false,
    copySampleSukis: params.options?.copySampleSukis === true,
    targetBusinessName: params.options?.targetBusinessName || "New branch",
  };

  const sourceRef = db.collection("businesses").doc(params.sourceBusinessId);
  const sourceSnap = await sourceRef.get();
  if (!sourceSnap.exists) throw new Error("SOURCE_NOT_FOUND");
  const source = sourceSnap.data() || {};
  if (source.ownerId !== params.ownerId) throw new Error("FORBIDDEN");

  const targetRef = db.collection("businesses").doc();
  const copied: string[] = [];

  const targetPayload: Record<string, unknown> = {
    name: opts.targetBusinessName,
    ownerId: params.ownerId,
    clonedFromBusinessId: params.sourceBusinessId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (opts.copyCatalog && Array.isArray(source.waterTypes)) {
    targetPayload.waterTypes = source.waterTypes;
    copied.push("waterTypes");
  }

  if (opts.copyNotificationDefaults && source.uiConfig) {
    targetPayload.uiConfig = {
      ...(source.uiConfig as Record<string, unknown>),
      clonedFrom: params.sourceBusinessId,
    };
    copied.push("uiConfig");
  }

  await targetRef.set(targetPayload);

  if (opts.copyMaintenanceTemplates) {
    const templates = await sourceRef.collection("maintenance_templates").get();
    const batch = db.batch();
    for (const doc of templates.docs) {
      batch.set(
        targetRef.collection("maintenance_templates").doc(),
        { ...doc.data(), clonedFrom: doc.id },
      );
    }
    if (!templates.empty) {
      await batch.commit();
      copied.push("maintenance_templates");
    }
  }

  if (opts.copyInventoryGroupings) {
    const items = await sourceRef.collection("inventory").limit(50).get();
    const batch = db.batch();
    for (const doc of items.docs) {
      const d = doc.data();
      batch.set(targetRef.collection("inventory").doc(), {
        name: d.name,
        category: d.category,
        stock: {
          current: 0,
          min: d.stock?.min ?? 0,
          lowStockThreshold: d.stock?.lowStockThreshold ?? 0,
        },
        clonedFrom: doc.id,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    if (!items.empty) {
      await batch.commit();
      copied.push("inventory");
    }
  }

  if (opts.copySampleSukis) {
    const customers = await sourceRef.collection("customers").limit(3).get();
    const batch = db.batch();
    for (const doc of customers.docs) {
      const d = doc.data();
      batch.set(targetRef.collection("customers").doc(), {
        name: `${d.name} (demo)`,
        phone: d.phone || "",
        address: d.address || "",
        type: d.type || "residential",
        status: "active",
        isDeliveryEnabled: true,
        isCollectionEnabled: false,
        clonedFrom: doc.id,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    if (!customers.empty) {
      await batch.commit();
      copied.push("sample_customers");
    }
  }

  logger.info("station_clone complete", {
    source: params.sourceBusinessId,
    target: targetRef.id,
    copied,
  });

  return {
    sourceBusinessId: params.sourceBusinessId,
    targetBusinessId: targetRef.id,
    copied,
  };
}
