import { Request, Response } from "express";
import { db, FieldValue } from "../config/firebase-admin";
import {
  logger,
  logAuditEvent,
} from "../services/observability/logging/logger";
import {
  InventoryImportFromFileService,
  type ExtractedInventoryDraft,
} from "../services/ai/inventory-import-from-file-service";
import { InventoryImportProfileService } from
  "../services/inventory/inventory-import-profile-service";
import { InventoryService } from "../services/inventory/inventory-service";

function getUser(req: Request) {
  return (req as { user?: { uid: string } }).user;
}

type InventoryCategoryRow = { name: string; description?: string };

async function ensureCategories(
  businessId: string,
  categoryNames: string[],
): Promise<void> {
  const snap = await db.collection("businesses").doc(businessId).get();
  if (!snap.exists) return;
  const existing = (snap.data()?.inventoryCategories ||
    []) as InventoryCategoryRow[];
  const existingLower = new Set(
    existing.map((c) => String(c.name || "").toLowerCase()),
  );
  const toAdd = categoryNames.filter(
    (n) => n && !existingLower.has(n.toLowerCase()),
  );
  if (!toAdd.length) return;

  const updated = [
    ...existing,
    ...toAdd.map((name) => ({ name, description: "" })),
  ];
  await db.collection("businesses").doc(businessId).update({
    inventoryCategories: updated,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

function toCreatePayload(row: ExtractedInventoryDraft) {
  const qty = Math.max(0, Math.round(Number(row.quantity) || 0));
  const min = Math.max(0, Math.round(Number(row.minStockThreshold) || 0));
  return {
    name: row.name,
    categoryId: row.category,
    stock: {
      current: qty,
      min,
      unit: row.unit || "pcs",
    },
    cost: Number(row.cost) || 0,
    ...(typeof row.avgUsage === "number" && Number.isFinite(row.avgUsage) ?
      { avgUsage: Math.max(0, row.avgUsage) } :
      {}),
  };
}

export async function getInventoryImportAiEligibility(
  req: Request,
  res: Response,
) {
  const { businessId } = req.params;
  try {
    const snap = await db.collection("businesses").doc(businessId).get();
    if (!snap.exists) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const freeUsed = !!snap.data()?.inventoryImportAiFreeUsed;
    res.json({
      data: {
        freeImportAvailable: !freeUsed,
      },
    });
  } catch (e) {
    logger.error("getInventoryImportAiEligibility", e);
    res.status(500).json({ error: "Failed to read import eligibility" });
  }
}

export async function postInventoryImportAiParse(req: Request, res: Response) {
  const { businessId } = req.params;
  const fileDataUri =
    typeof req.body?.fileDataUri === "string" ? req.body.fileDataUri : "";
  if (!fileDataUri.trim()) {
    res
      .status(400)
      .json({ error: "fileDataUri is required (data:<mime>;base64,...)" });
    return;
  }

  try {
    const bizRef = db.collection("businesses").doc(businessId);
    const bizSnap = await bizRef.get();
    if (!bizSnap.exists) {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const freeUsedBefore = !!bizSnap.data()?.inventoryImportAiFreeUsed;

    const data =
      await InventoryImportFromFileService.extractFromDataUri(fileDataUri);

    if (!freeUsedBefore) {
      await bizRef.update({
        inventoryImportAiFreeUsed: true,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    res.json({ data });
  } catch (e) {
    logger.error("postInventoryImportAiParse", e);
    res.status(500).json({ error: "AI import preview failed" });
  }
}

export async function postInventoryImportAiProfile(
  req: Request,
  res: Response,
) {
  const { businessId } = req.params;
  const rawRows = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!rawRows.length) {
    res.status(400).json({ error: "items array is required" });
    return;
  }
  if (rawRows.length > 100) {
    res.status(400).json({ error: "Too many rows in one import (max 100)" });
    return;
  }

  try {
    const result = await InventoryImportProfileService.profileImport(
      businessId,
      rawRows as ExtractedInventoryDraft[],
    );
    res.json({ data: result });
  } catch (e) {
    logger.error("postInventoryImportAiProfile", e);
    res.status(500).json({ error: "Import profiling failed" });
  }
}

export async function postInventoryImportAiCommit(req: Request, res: Response) {
  const { businessId } = req.params;
  const user = getUser(req);
  if (!user?.uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const rawRows = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!rawRows.length) {
    res.status(400).json({ error: "items array is required" });
    return;
  }
  if (rawRows.length > 100) {
    res.status(400).json({ error: "Too many rows in one commit (max 100)" });
    return;
  }

  try {
    const profiled = await InventoryImportProfileService.profileImport(
      businessId,
      rawRows as ExtractedInventoryDraft[],
    );
    const { rows, summary } = profiled;

    if (!profiled.canImportClean || summary.clean === 0) {
      res.status(400).json({
        error: "NO_CLEAN_ROWS",
        message:
          "No rows passed data checks. Fix flagged issues or remove duplicates, then try again.",
        data: {
          summary,
          rows,
          imported: [],
        },
      });
      return;
    }

    const cleanRows = rows.filter((r) => r.status === "clean");
    const categoryNames = Array.from(
      new Set(cleanRows.map((r) => r.item.category).filter(Boolean)),
    );
    await ensureCategories(businessId, categoryNames);

    const created: { id: string; name: string; index: number }[] = [];
    const importErrors: { index: number; message: string }[] = [];

    for (const row of cleanRows) {
      try {
        const id = await InventoryService.createItem(
          businessId,
          toCreatePayload(row.item),
        );
        created.push({ id, name: row.item.name, index: row.index });
      } catch (err) {
        logger.warn("postInventoryImportAiCommit row failed", {
          businessId,
          index: row.index,
          err,
        });
        importErrors.push({
          index: row.index,
          message: "Could not create inventory item",
        });
      }
    }

    const flaggedRows = [
      ...rows.filter((r) => r.status === "flagged"),
      ...importErrors.map((e) => {
        const src = rows.find((r) => r.index === e.index);
        return {
          index: e.index,
          item: src?.item || { name: "", category: "" },
          status: "flagged" as const,
          issues: [e.message, ...(src?.issues || [])],
        };
      }),
    ];

    await logAuditEvent("INVENTORY_AI_IMPORT_COMMITTED", {
      businessId,
      userId: user.uid,
      totalRows: summary.total,
      importedCount: created.length,
      flaggedCount: summary.flagged + importErrors.length,
      sampleNames: created.slice(0, 5).map((c) => c.name),
    });

    res.status(201).json({
      data: {
        summary: {
          total: summary.total,
          imported: created.length,
          flagged: summary.flagged + importErrors.length,
          failedDuringSave: importErrors.length,
        },
        imported: created,
        flagged: flaggedRows,
        importErrors,
      },
    });
  } catch (e) {
    logger.error("postInventoryImportAiCommit", e);
    res.status(500).json({ error: "Import commit failed" });
  }
}
