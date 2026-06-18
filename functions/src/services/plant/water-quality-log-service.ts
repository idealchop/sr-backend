import { db, FieldValue } from "../../config/firebase-admin";
import { readPlantConfig } from "../../utils/plant-staff-token";
import { manilaDateKey } from "../../utils/philippine-datetime";
import { addManilaDays } from "./maintenance-template-utils";

export type WaterQualityLocationTag = "product" | "reject" | "raw";

export type WaterQualityLogRecord = {
  id: string;
  recordedAt: string;
  tdsPpm: number;
  ph?: number;
  chlorinePpm?: number;
  locationTag: WaterQualityLocationTag;
  operatorName?: string;
  source: "manual" | "device";
  deviceId?: string;
  pass?: boolean;
  notes?: string;
};

export type CreateWaterQualityLogInput = {
  recordedAt?: string;
  tdsPpm: number;
  ph?: number;
  chlorinePpm?: number;
  locationTag: WaterQualityLocationTag;
  operatorName?: string;
  source?: "manual" | "device";
  deviceId?: string;
  notes?: string;
};

function evaluatePass(
  plantConfig: ReturnType<typeof readPlantConfig>,
  input: CreateWaterQualityLogInput,
): boolean | undefined {
  if (input.locationTag !== "product") return undefined;
  const maxTds = Number(plantConfig.tdsMaxProduct);
  if (Number.isFinite(maxTds) && input.tdsPpm > maxTds) return false;
  const phMin = Number(plantConfig.phMinProduct);
  const phMax = Number(plantConfig.phMaxProduct);
  if (input.ph != null && Number.isFinite(phMin) && input.ph < phMin) return false;
  if (input.ph != null && Number.isFinite(phMax) && input.ph > phMax) return false;
  if (Number.isFinite(maxTds) || Number.isFinite(phMin) || Number.isFinite(phMax)) {
    return true;
  }
  return undefined;
}

/**
 * MP-09 — water quality log CRUD.
 */
export class WaterQualityLogService {
  static collection(businessId: string) {
    return db
      .collection("businesses")
      .doc(businessId)
      .collection("water_quality_logs");
  }

  static async list(
    businessId: string,
    limit = 30,
  ): Promise<WaterQualityLogRecord[]> {
    const snap = await this.collection(businessId)
      .orderBy("recordedAt", "desc")
      .limit(limit)
      .get();

    return snap.docs.map((doc) => {
      const d = doc.data();
      const recordedAt = d.recordedAt?.toDate ?
        d.recordedAt.toDate().toISOString() :
        String(d.recordedAt || "");
      return {
        id: doc.id,
        recordedAt,
        tdsPpm: Number(d.tdsPpm) || 0,
        ph: d.ph != null ? Number(d.ph) : undefined,
        chlorinePpm: d.chlorinePpm != null ? Number(d.chlorinePpm) : undefined,
        locationTag: (d.locationTag || "product") as WaterQualityLocationTag,
        operatorName: d.operatorName ? String(d.operatorName) : undefined,
        source: d.source === "device" ? "device" : "manual",
        deviceId: d.deviceId ? String(d.deviceId) : undefined,
        pass: typeof d.pass === "boolean" ? d.pass : undefined,
        notes: d.notes ? String(d.notes) : undefined,
      };
    });
  }

  static async create(
    businessId: string,
    input: CreateWaterQualityLogInput,
    userId?: string,
  ): Promise<WaterQualityLogRecord> {
    const bizSnap = await db.collection("businesses").doc(businessId).get();
    const plantConfig = readPlantConfig(bizSnap.data() ?? {});
    const pass = evaluatePass(plantConfig, input);
    const recordedAt = input.recordedAt ?
      new Date(input.recordedAt) :
      new Date();

    const source: "manual" | "device" = input.source === "device" ? "device" : "manual";
    const doc = {
      recordedAt,
      tdsPpm: Number(input.tdsPpm),
      ...(input.ph != null ? { ph: Number(input.ph) } : {}),
      ...(input.chlorinePpm != null ?
        { chlorinePpm: Number(input.chlorinePpm) } :
        {}),
      locationTag: input.locationTag,
      ...(input.operatorName ? { operatorName: input.operatorName.slice(0, 80) } : {}),
      source,
      ...(input.deviceId ? { deviceId: input.deviceId.slice(0, 64) } : {}),
      ...(pass !== undefined ? { pass } : {}),
      ...(input.notes ? { notes: input.notes.slice(0, 300) } : {}),
      createdByUid: userId || null,
      createdAt: FieldValue.serverTimestamp(),
    };

    const ref = await this.collection(businessId).add(doc);
    const record: WaterQualityLogRecord = {
      id: ref.id,
      recordedAt: recordedAt.toISOString(),
      tdsPpm: doc.tdsPpm,
      ph: doc.ph,
      chlorinePpm: doc.chlorinePpm,
      locationTag: input.locationTag,
      operatorName: doc.operatorName,
      source: doc.source,
      deviceId: doc.deviceId,
      pass: doc.pass,
      notes: doc.notes,
    };

    if (input.locationTag === "product" && pass === false) {
      await this.maybeCreateTdsThresholdTask(businessId, plantConfig);
    }

    return record;
  }

  /**
   * MP-22 — auto urgent PM when product TDS fails 3 consecutive readings.
   */
  static async maybeCreateTdsThresholdTask(
    businessId: string,
    plantConfig: ReturnType<typeof readPlantConfig>,
  ): Promise<void> {
    const maxTds = Number(plantConfig.tdsMaxProduct);
    if (!Number.isFinite(maxTds)) return;

    const recent = await this.collection(businessId)
      .where("locationTag", "==", "product")
      .orderBy("recordedAt", "desc")
      .limit(3)
      .get();
    if (recent.size < 3) return;

    const allFailed = recent.docs.every((docSnap) => {
      const d = docSnap.data();
      if (d.pass === false) return true;
      const tds = Number(d.tdsPpm);
      return Number.isFinite(tds) && tds > maxTds;
    });
    if (!allFailed) return;

    const templateRef = db
      .collection("businesses")
      .doc(businessId)
      .collection("maintenance_templates")
      .doc("tds_threshold_alert");

    const existing = await templateRef.get();
    const today = manilaDateKey(new Date());
    const payload = {
      slug: "tds_threshold_alert",
      name: "TDS threshold exceeded",
      intervalDays: 1,
      dueAfterGallons: null,
      gallonsSinceLastComplete: 0,
      nextDueAt: today,
      autoTriggered: true,
      updatedAt: FieldValue.serverTimestamp(),
      ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    };
    await templateRef.set(payload, { merge: true });

    if (!existing.exists || String(existing.data()?.nextDueAt || "") > today) {
      await templateRef.set(
        { nextDueAt: today, lastAutoTriggerAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    }

    const staleDue = existing.exists && String(existing.data()?.nextDueAt || "") > today;
    if (!existing.exists || staleDue) {
      await templateRef.set(
        {
          nextDueAt: addManilaDays(today, 0),
          checklist: [
            "Inspect RO membrane and pre-filters",
            "Verify TDS probe calibration",
            "Re-test product water before resuming sales",
          ],
        },
        { merge: true },
      );
    }
  }
}
