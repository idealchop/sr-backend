import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../config/firebase-admin";
import {
  addManilaDays,
  buildDefaultMaintenanceTemplates,
  serializeMaintenanceTemplate,
  sortMaintenanceTemplates,
} from "./maintenance-template-utils";
import type { MaintenanceTemplateRecord } from "./maintenance-template-types";
import { manilaDateKey } from "../../utils/philippine-datetime";

export class MaintenanceTemplateService {
  static collection(businessId: string) {
    return db
      .collection("businesses")
      .doc(businessId)
      .collection("maintenance_templates");
  }

  static async list(businessId: string): Promise<MaintenanceTemplateRecord[]> {
    const col = this.collection(businessId);
    const snap = await col.get();
    if (snap.empty) {
      await this.seedDefaults(businessId);
      const seeded = await col.get();
      return sortMaintenanceTemplates(
        seeded.docs.map((doc) => serializeMaintenanceTemplate(doc.id, doc.data())),
      );
    }
    return sortMaintenanceTemplates(
      snap.docs.map((doc) => serializeMaintenanceTemplate(doc.id, doc.data())),
    );
  }

  static async seedDefaults(businessId: string): Promise<void> {
    const col = this.collection(businessId);
    const batch = db.batch();
    const now = FieldValue.serverTimestamp();
    for (const seed of buildDefaultMaintenanceTemplates()) {
      const ref = col.doc(seed.slug);
      batch.set(ref, {
        ...seed,
        createdAt: now,
        updatedAt: now,
      });
    }
    await batch.commit();
  }

  static async complete(
    businessId: string,
    templateId: string,
  ): Promise<MaintenanceTemplateRecord> {
    const ref = this.collection(businessId).doc(templateId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new Error("Maintenance template not found");
    }

    const intervalDays = Number(snap.data()?.intervalDays ?? 30);
    const completedAt = new Date().toISOString();
    const nextDueAt = addManilaDays(manilaDateKey(new Date()), intervalDays);

    await ref.set(
      {
        lastCompletedAt: completedAt,
        nextDueAt,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const updated = await ref.get();
    return serializeMaintenanceTemplate(updated.id, updated.data() ?? {});
  }
}
