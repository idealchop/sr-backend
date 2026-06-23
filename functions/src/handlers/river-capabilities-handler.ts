import { Request, Response } from "express";
import { db } from "../config/firebase-admin";
import { logger } from "../services/observability/logging/logger";
import { CustomerService } from "../services/customers/customer-service";
import { CustomerMergeService } from "../services/customers/customer-merge-service";
import { InventoryService } from "../services/inventory/inventory-service";
import {
  detectDuplicateCustomerGroups,
  validateDuplicateCustomerGroupsWithAi,
} from "../services/ai/duplicate-customers-service";
import {
  dismissDuplicateCustomer,
  excludeDismissedDuplicateCustomers,
  readDismissedDuplicateCustomerIds,
} from "../services/ai/duplicate-dismissals-service";
import { LedgerScanService } from "../services/ai/ledger-scan-service";
import { LedgerScanCommitService } from "../services/ai/ledger-scan-commit-service";
import { InventoryScanService } from "../services/ai/inventory-scan-service";

function getUser(req: Request) {
  return (req as { user?: { uid: string } }).user;
}

export async function postLedgerScanText(req: Request, res: Response) {
  const { businessId } = req.params;
  const body = req.body || {};
  const ledgerText = typeof body.ledgerText === "string" ? body.ledgerText : "";
  const currentDate =
    typeof body.currentDate === "string" ? body.currentDate : "";
  const tomorrowDate =
    typeof body.tomorrowDate === "string" ? body.tomorrowDate : "";
  if (!ledgerText.trim() || !currentDate) {
    res.status(400).json({ error: "ledgerText and currentDate are required" });
    return;
  }
  try {
    const [customers, items] = await Promise.all([
      CustomerService.getCustomersByBusiness(businessId),
      InventoryService.listItems(businessId),
    ]);
    const catalog = items.map((i) => ({
      id: i.id || "",
      name: i.name,
      category: i.categoryId || "",
    }));
    const data = await LedgerScanService.extractFromText({
      ledgerText,
      currentDate,
      tomorrowDate: tomorrowDate || currentDate,
      customers,
      catalog,
    });
    res.json({ data });
  } catch (e) {
    logger.error("postLedgerScanText", e);
    res.status(500).json({ error: "Ledger scan failed" });
  }
}

export async function postLedgerScanImage(req: Request, res: Response) {
  const { businessId } = req.params;
  const body = req.body || {};
  const ledgerImageDataUri =
    typeof body.ledgerImageDataUri === "string" ? body.ledgerImageDataUri : "";
  const currentDate =
    typeof body.currentDate === "string" ? body.currentDate : "";
  const tomorrowDate =
    typeof body.tomorrowDate === "string" ? body.tomorrowDate : "";
  if (!ledgerImageDataUri || !currentDate) {
    res
      .status(400)
      .json({ error: "ledgerImageDataUri and currentDate are required" });
    return;
  }
  try {
    const [customers, items] = await Promise.all([
      CustomerService.getCustomersByBusiness(businessId),
      InventoryService.listItems(businessId),
    ]);
    const catalog = items.map((i) => ({
      id: i.id || "",
      name: i.name,
      category: i.categoryId || "",
    }));
    const data = await LedgerScanService.extractFromImage({
      ledgerImageDataUri,
      currentDate,
      tomorrowDate: tomorrowDate || currentDate,
      customers,
      catalog,
    });
    res.json({ data });
  } catch (e) {
    logger.error("postLedgerScanImage", e);
    res.status(500).json({ error: "Ledger image scan failed" });
  }
}

export async function postLedgerScanCommit(req: Request, res: Response) {
  const { businessId } = req.params;
  const user = getUser(req);
  if (!user?.uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const rows = Array.isArray(req.body?.transactions) ?
    req.body.transactions :
    [];
  if (!rows.length) {
    res.status(400).json({ error: "transactions array required" });
    return;
  }

  try {
    const biz = await db.collection("businesses").doc(businessId).get();
    const cfg = biz.data()?.config || {};
    const waterTypes = (cfg.waterTypes || []) as {
      id?: string;
      name?: string;
      price?: number;
    }[];
    const first = waterTypes[0] || {};
    const defaultWaterTypeId = String(
      req.body?.defaultWaterTypeId || first.id || "default-water",
    );
    const defaultWaterName = String(first.name || "Refill");
    const defaultUnitPrice =
      Number(req.body?.defaultUnitPrice || first.price || 25) || 25;

    const inventoryLines = Array.isArray(req.body?.inventoryLines) ?
      req.body.inventoryLines :
      [];

    const result = await LedgerScanCommitService.commitExtracted({
      businessId,
      userId: user.uid,
      rows,
      inventoryLines,
      defaultWaterTypeId,
      defaultWaterName,
      defaultUnitPrice,
    });
    res.status(201).json({ data: result });
  } catch (e) {
    logger.error("postLedgerScanCommit", e);
    res.status(500).json({ error: "Failed to commit ledger rows" });
  }
}

export async function postDuplicatesDetect(req: Request, res: Response) {
  const { businessId } = req.params;
  try {
    const [customers, businessDoc] = await Promise.all([
      CustomerService.getCustomersByBusiness(businessId),
      db.collection("businesses").doc(businessId).get(),
    ]);
    const dismissedCustomerIds = readDismissedDuplicateCustomerIds(
      businessDoc.data()?.uiConfig as Record<string, unknown> | undefined,
    );
    const activeCustomers = excludeDismissedDuplicateCustomers(
      customers,
      dismissedCustomerIds,
    );
    const heuristicGroups = detectDuplicateCustomerGroups(activeCustomers);
    const duplicateGroups = await validateDuplicateCustomerGroupsWithAi(
      heuristicGroups,
    );
    res.json({
      data: {
        duplicateGroups,
        aiValidated: duplicateGroups.some((group) => group.aiValidation),
      },
    });
  } catch (e) {
    logger.error("postDuplicatesDetect", e);
    res.status(500).json({ error: "Duplicate detection failed" });
  }
}

export async function postDuplicatesDismiss(req: Request, res: Response) {
  const { businessId } = req.params;
  const customerId = String(req.body?.customerId || "").trim();
  if (!customerId) {
    res.status(400).json({ error: "customerId is required" });
    return;
  }
  try {
    const data = await dismissDuplicateCustomer({ businessId, customerId });
    res.json({ data });
  } catch (e: unknown) {
    logger.error("postDuplicatesDismiss", e);
    const message = e instanceof Error ? e.message : "Failed to keep suki separate";
    res.status(500).json({ error: message });
  }
}

export async function postDuplicatesMerge(req: Request, res: Response) {
  const { businessId } = req.params;
  const user = getUser(req);
  if (!user?.uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const primaryCustomerId = String(req.body?.primaryCustomerId || "");
  const duplicateCustomerIds = Array.isArray(req.body?.duplicateCustomerIds) ?
    req.body.duplicateCustomerIds.map(String) :
    [];
  if (!primaryCustomerId || !duplicateCustomerIds.length) {
    res
      .status(400)
      .json({ error: "primaryCustomerId and duplicateCustomerIds required" });
    return;
  }
  try {
    const data = await CustomerMergeService.mergeCustomers({
      businessId,
      primaryCustomerId,
      duplicateCustomerIds,
      actorUid: user.uid,
    });
    res.json({ data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg.startsWith("DUPLICATE_NOT_FOUND") ||
      msg === "PRIMARY_NOT_FOUND" ||
      msg === "NO_DUPLICATES"
    ) {
      res.status(400).json({ error: msg });
      return;
    }
    logger.error("postDuplicatesMerge", e);
    res.status(500).json({ error: "Merge failed" });
  }
}

export async function postInventoryScanText(req: Request, res: Response) {
  const { businessId } = req.params;
  const inventoryText =
    typeof req.body?.inventoryText === "string" ? req.body.inventoryText : "";
  if (!inventoryText.trim()) {
    res.status(400).json({ error: "inventoryText required" });
    return;
  }
  try {
    const items = await InventoryService.listItems(businessId);
    const catalog = items.map((i) => ({
      id: i.id || "",
      name: i.name,
      category: i.categoryId || "",
    }));
    const data = await InventoryScanService.extractFromText({
      inventoryText,
      catalog,
    });
    res.json({ data });
  } catch (e) {
    logger.error("postInventoryScanText", e);
    res.status(500).json({ error: "Inventory text scan failed" });
  }
}

export async function postInventoryScanImage(req: Request, res: Response) {
  const { businessId } = req.params;
  const inventoryImageDataUri =
    typeof req.body?.inventoryImageDataUri === "string" ?
      req.body.inventoryImageDataUri :
      "";
  if (!inventoryImageDataUri) {
    res.status(400).json({ error: "inventoryImageDataUri required" });
    return;
  }
  try {
    const items = await InventoryService.listItems(businessId);
    const catalog = items.map((i) => ({
      id: i.id || "",
      name: i.name,
      category: i.categoryId || "",
    }));
    const data = await InventoryScanService.extractFromImage({
      inventoryImageDataUri,
      catalog,
    });
    res.json({ data });
  } catch (e) {
    logger.error("postInventoryScanImage", e);
    res.status(500).json({ error: "Inventory image scan failed" });
  }
}

export async function postInventoryScanApply(req: Request, res: Response) {
  const { businessId } = req.params;
  const user = getUser(req);
  if (!user?.uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const mode = req.body?.mode === "subtract" ? "subtract" : "add";
  const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
  if (!lines.length) {
    res.status(400).json({ error: "lines required" });
    return;
  }

  try {
    const applied: {
      inventoryItemId: string;
      delta: number;
      newStock?: number;
    }[] = [];
    for (const line of lines) {
      const id = String(line?.inventoryItemId || "");
      const count = Number(line?.count);
      if (!id || !Number.isFinite(count) || count <= 0) continue;
      const delta = mode === "add" ? count : -count;
      const newStock = await InventoryService.adjustStock(
        businessId,
        id,
        delta,
        {
          userId: user.uid,
          reason: `AI_INVENTORY_SCAN_${mode.toUpperCase()}`,
        },
      );
      applied.push({ inventoryItemId: id, delta, newStock });
    }
    res.json({ data: { applied } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("postInventoryScanApply", e);
    res.status(400).json({ error: msg || "Apply failed" });
  }
}
