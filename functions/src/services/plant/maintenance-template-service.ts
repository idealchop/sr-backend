import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../config/firebase-admin";
import {
  addManilaDays,
  buildDefaultMaintenanceTemplates,
  computePmGallonRecurrenceUpdate,
  serializeMaintenanceTemplate,
  sortMaintenanceTemplates,
} from "./maintenance-template-utils";
import type { MaintenanceTemplateRecord } from "./maintenance-template-types";
import { manilaDateKey } from "../../utils/philippine-datetime";
import { InventoryService } from "../inventory/inventory-service";
import { TransactionService } from "../transactions/transaction-service";
import { ProductionShiftService } from "./production-shift-service";
import type {
  MaintenanceCompleteInput,
  MaintenanceCompleteResult,
} from "./maintenance-complete-types";
import type { MaintenanceCompletionPdfRow } from "./maintenance-compliance-pdf-service";

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
      await this.syncGallonRecurrence(businessId);
      const refreshed = await col.get();
      return sortMaintenanceTemplates(
        refreshed.docs.map((doc) => serializeMaintenanceTemplate(doc.id, doc.data())),
      );
    }

    await this.syncGallonRecurrence(businessId);
    const refreshed = await col.get();
    return sortMaintenanceTemplates(
      refreshed.docs.map((doc) => serializeMaintenanceTemplate(doc.id, doc.data())),
    );
  }

  /**
   * MP-11 — roll gallon counters from production shifts; pull nextDueAt forward when threshold hit.
   * @return {Promise<number>} Number of templates updated.
   */
  static async syncGallonRecurrence(businessId: string): Promise<number> {
    const col = this.collection(businessId);
    const templatesSnap = await col.get();
    if (templatesSnap.empty) return 0;

    const shifts = await ProductionShiftService.list(businessId, { limit: 90 });
    const todayKey = manilaDateKey(new Date());
    const batch = db.batch();
    let batchCount = 0;

    for (const templateDoc of templatesSnap.docs) {
      const template = serializeMaintenanceTemplate(templateDoc.id, templateDoc.data());
      const update = computePmGallonRecurrenceUpdate(template, shifts, todayKey);
      if (!update) continue;

      const updates: Record<string, unknown> = {
        gallonsSinceLastComplete: update.gallonsSinceLastComplete,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (update.nextDueAt) {
        updates.nextDueAt = update.nextDueAt;
      }
      batch.update(templateDoc.ref, updates);
      batchCount += 1;
    }

    if (batchCount > 0) {
      await batch.commit();
    }
    return batchCount;
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

  static async resolveConsumableInventoryIds(
    businessId: string,
    consumes: { itemNameHint: string; qty: number }[],
  ): Promise<Array<{ inventoryId: string; name: string; qty: number }>> {
    if (!consumes.length) return [];
    const items = await InventoryService.listItems(businessId);
    const resolved: Array<{ inventoryId: string; name: string; qty: number }> = [];
    const usedIds = new Set<string>();

    for (const link of consumes) {
      const hint = link.itemNameHint.toLowerCase();
      const match = items.find((item) => {
        if (!item.id || usedIds.has(item.id)) return false;
        const name = String(item.name || "").toLowerCase();
        const category = String(item.categoryId || "").toLowerCase();
        return name.includes(hint) || (category.includes("maintenance") && name.includes(hint));
      });
      if (match?.id) {
        usedIds.add(match.id);
        resolved.push({
          inventoryId: match.id,
          name: match.name,
          qty: link.qty,
        });
      }
    }

    return resolved;
  }

  static async complete(
    businessId: string,
    templateId: string,
    input: MaintenanceCompleteInput,
  ): Promise<MaintenanceCompleteResult> {
    const ref = this.collection(businessId).doc(templateId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new Error("Maintenance template not found");
    }

    const data = snap.data() ?? {};
    const template = serializeMaintenanceTemplate(snap.id, data);
    const intervalDays = template.intervalDays;
    const completedAt = new Date().toISOString();
    const nextDueAt = addManilaDays(manilaDateKey(new Date()), intervalDays);

    let expenseId: string | undefined;
    if (input.expense && Number(input.expense.amount) > 0) {
      const amount = Math.round(Number(input.expense.amount) * 100) / 100;
      const note =
        (input.expense.note || `${template.name} maintenance`).trim().slice(0, 200);
      const { transaction: expenseTx } = await TransactionService.addTransaction(
        businessId,
        {
          type: "expense",
          customerName: "Expenses",
          totalAmount: amount,
          amountPaid: amount,
          paymentStatus: "paid",
          paymentMethod: "cash",
          expenseCategory: "Maintenance",
          notes: note,
          scheduledAt: completedAt,
          deliveryStatus: "delivered",
        },
        input.userId,
      );
      expenseId = expenseTx.id;
    }

    const consumablesAdjusted: string[] = [];
    if (input.decrementConsumables && template.consumes.length > 0) {
      const links = await this.resolveConsumableInventoryIds(
        businessId,
        template.consumes,
      );
      for (const link of links) {
        try {
          await InventoryService.adjustStock(
            businessId,
            link.inventoryId,
            -link.qty,
            { userId: input.userId, reason: `PM: ${template.name}` },
          );
          consumablesAdjusted.push(`${link.name} (−${link.qty})`);
        } catch {
          // Skip consumable decrement when stock is insufficient — PM still completes.
        }
      }
    }

    await ref.collection("completions").add({
      completedAt,
      checklistChecked: input.checklistChecked ?? [],
      proofUrl: input.proofUrl || null,
      notes: input.notes || null,
      expenseId: expenseId || null,
      consumablesAdjusted,
      createdByUid: input.userId,
      createdAt: FieldValue.serverTimestamp(),
    });

    await ref.set(
      {
        lastCompletedAt: completedAt,
        nextDueAt,
        gallonsSinceLastComplete: 0,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const updated = await ref.get();
    return {
      template: serializeMaintenanceTemplate(updated.id, updated.data() ?? {}),
      expenseId,
      consumablesAdjusted,
    };
  }

  /** MP-15 — completed PM rows within the reporting window. */
  static async listCompletionsSince(
    businessId: string,
    periodDays: number,
  ): Promise<MaintenanceCompletionPdfRow[]> {
    const sinceKey = addManilaDays(manilaDateKey(new Date()), -periodDays);
    const sinceMs = new Date(`${sinceKey}T00:00:00+08:00`).getTime();

    const templatesSnap = await this.collection(businessId).get();
    const rows: MaintenanceCompletionPdfRow[] = [];

    for (const templateDoc of templatesSnap.docs) {
      const templateName = String(templateDoc.data().name || templateDoc.id);
      const completionsSnap = await templateDoc.ref
        .collection("completions")
        .orderBy("completedAt", "desc")
        .get();

      for (const doc of completionsSnap.docs) {
        const data = doc.data();
        const completedAt = data.completedAt?.toDate ?
          data.completedAt.toDate().toISOString() :
          String(data.completedAt || "");
        const completedMs = new Date(completedAt).getTime();
        if (!Number.isFinite(completedMs) || completedMs < sinceMs) continue;

        rows.push({
          templateName,
          completedAt,
          notes: data.notes ? String(data.notes) : null,
          proofUrl: data.proofUrl ? String(data.proofUrl) : null,
        });
      }
    }

    rows.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    return rows;
  }

  /** MP-11 — owner adjusts gallon threshold for PM recurrence. */
  static async updateDueAfterGallons(
    businessId: string,
    templateId: string,
    dueAfterGallons: number | null,
  ): Promise<MaintenanceTemplateRecord> {
    const ref = this.collection(businessId).doc(templateId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new Error("Maintenance template not found");
    }

    const normalized =
      dueAfterGallons != null && Number.isFinite(dueAfterGallons) && dueAfterGallons > 0 ?
        Math.round(dueAfterGallons) :
        null;

    await ref.set(
      {
        dueAfterGallons: normalized,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const updated = await ref.get();
    return serializeMaintenanceTemplate(updated.id, updated.data() ?? {});
  }
}
