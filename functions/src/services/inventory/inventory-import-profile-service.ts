import type { ExtractedInventoryDraft } from "../ai/inventory-import-from-file-service";
import type { InventoryItem } from "./inventory-service";
import { InventoryService } from "./inventory-service";
import { namesAreDuplicateLike } from "../ai/name-fuzzy";

export type InventoryImportRowStatus = "clean" | "flagged";

export type ProfiledInventoryImportRow = {
  index: number;
  item: ExtractedInventoryDraft;
  status: InventoryImportRowStatus;
  issues: string[];
};

export type InventoryImportProfileResult = {
  rows: ProfiledInventoryImportRow[];
  summary: {
    total: number;
    clean: number;
    flagged: number;
  };
  canImportClean: boolean;
};

function normalizeNameKey(name: string): string {
  return name.trim().toLowerCase();
}

export class InventoryImportProfileService {
  static profileRows(
    rows: ExtractedInventoryDraft[],
    existingItems: InventoryItem[],
  ): InventoryImportProfileResult {
    const existingByName = new Map<string, InventoryItem>();
    for (const item of existingItems) {
      const key = normalizeNameKey(item.name || "");
      if (key) existingByName.set(key, item);
    }

    const fileNameSeen = new Map<string, number>();

    const profiled: ProfiledInventoryImportRow[] = rows.map((raw, index) => {
      const issues: string[] = [];
      const name = String(raw?.name || "").trim();
      const category = String(raw?.category || "").trim();
      const quantity =
        typeof raw?.quantity === "number" && Number.isFinite(raw.quantity) ?
          Math.max(0, raw.quantity) :
          0;
      const minStockThreshold =
        typeof raw?.minStockThreshold === "number" &&
        Number.isFinite(raw.minStockThreshold) ?
          Math.max(0, raw.minStockThreshold) :
          0;
      const unit = String(raw?.unit || "pcs").trim() || "pcs";
      const cost =
        typeof raw?.cost === "number" && Number.isFinite(raw.cost) ?
          Math.max(0, raw.cost) :
          0;

      const item: ExtractedInventoryDraft = {
        ...raw,
        name,
        category,
        quantity,
        minStockThreshold,
        unit,
        cost,
      };

      if (!name) issues.push("Missing item name");
      if (!category) issues.push("Missing category");

      if (minStockThreshold > quantity && quantity > 0) {
        issues.push(
          "Min stock threshold is higher than current quantity — check values",
        );
      }

      const nameKey = normalizeNameKey(name);
      if (nameKey) {
        const firstIdx = fileNameSeen.get(nameKey);
        if (firstIdx !== undefined) {
          issues.push(`Duplicate name in file (same as row ${firstIdx + 1})`);
        } else {
          fileNameSeen.set(nameKey, index);
        }

        const existing = existingByName.get(nameKey);
        if (existing) {
          issues.push(
            `Item name already exists in inventory ("${existing.name}")`,
          );
        } else {
          for (const ex of existingItems) {
            if (ex.name && namesAreDuplicateLike(name, ex.name)) {
              issues.push(`Name is very similar to existing item "${ex.name}"`);
              break;
            }
          }
        }
      }

      const status: InventoryImportRowStatus = issues.length ?
        "flagged" :
        "clean";
      return { index, item, status, issues };
    });

    const clean = profiled.filter((r) => r.status === "clean").length;
    const flagged = profiled.length - clean;

    return {
      rows: profiled,
      summary: { total: profiled.length, clean, flagged },
      canImportClean: clean > 0,
    };
  }

  static async profileImport(
    businessId: string,
    rows: ExtractedInventoryDraft[],
  ): Promise<InventoryImportProfileResult> {
    const existing = await InventoryService.listItems(businessId);
    return this.profileRows(rows, existing);
  }
}
