import { Request, Response } from "express";
import { db, FieldValue } from "../config/firebase-admin";
import {
  logger,
  logAuditEvent,
} from "../services/observability/logging/logger";
import {
  CustomerHistoryImportFromFileService,
  type ExtractedCustomerHistoryRow,
} from "../services/ai/customer-history-import-from-file-service";
import { CustomerHistoryImportProfileService } from
  "../services/customers/customer-history-import-profile-service";
import { CustomerHistoryImportCommitService } from
  "../services/ai/customer-history-import-commit-service";
import type { Transaction } from "../services/transactions/transaction-service";

function getUser(req: Request) {
  return (req as { user?: { uid: string } }).user;
}

function customerRef(businessId: string, customerId: string) {
  return db
    .collection("businesses")
    .doc(businessId)
    .collection("customers")
    .doc(customerId);
}

export async function getCustomerHistoryImportAiEligibility(
  req: Request,
  res: Response,
) {
  const { businessId, customerId } = req.params;
  try {
    const snap = await customerRef(businessId, customerId).get();
    if (!snap.exists) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    const freeUsed = !!snap.data()?.historyImportAiFreeUsed;
    res.json({
      data: {
        freeImportAvailable: !freeUsed,
      },
    });
  } catch (e) {
    logger.error("getCustomerHistoryImportAiEligibility", e);
    res.status(500).json({ error: "Failed to read import eligibility" });
  }
}

export async function postCustomerHistoryImportAiParse(
  req: Request,
  res: Response,
) {
  const { businessId, customerId } = req.params;
  const fileDataUri =
    typeof req.body?.fileDataUri === "string" ? req.body.fileDataUri : "";
  const currentDate =
    typeof req.body?.currentDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(req.body.currentDate) ?
      req.body.currentDate :
      new Date().toISOString().slice(0, 10);

  if (!fileDataUri.trim()) {
    res
      .status(400)
      .json({ error: "fileDataUri is required (data:<mime>;base64,...)" });
    return;
  }

  try {
    const ref = customerRef(businessId, customerId);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    const customer = snap.data() || {};
    const freeUsedBefore = !!customer.historyImportAiFreeUsed;

    const data = await CustomerHistoryImportFromFileService.extractFromDataUri({
      fileDataUri,
      customerName: String(customer.name || "Customer"),
      customerAddress: String(customer.address || ""),
      currentDate,
    });

    if (!freeUsedBefore) {
      await ref.update({
        historyImportAiFreeUsed: true,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    res.json({ data });
  } catch (e) {
    logger.error("postCustomerHistoryImportAiParse", e);
    res.status(500).json({ error: "AI history import preview failed" });
  }
}

async function loadCustomerTransactions(
  businessId: string,
  customerId: string,
): Promise<Transaction[]> {
  const snap = await db
    .collection("businesses")
    .doc(businessId)
    .collection("transactions")
    .where("customerId", "==", customerId)
    .limit(500)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Transaction[];
}

export async function postCustomerHistoryImportAiProfile(
  req: Request,
  res: Response,
) {
  const { businessId, customerId } = req.params;
  const rawRows = Array.isArray(req.body?.transactions) ?
    req.body.transactions :
    [];
  if (!rawRows.length) {
    res.status(400).json({ error: "transactions array is required" });
    return;
  }
  if (rawRows.length > 100) {
    res.status(400).json({ error: "Too many rows in one import (max 100)" });
    return;
  }

  try {
    const snap = await customerRef(businessId, customerId).get();
    if (!snap.exists) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    const existing = await loadCustomerTransactions(businessId, customerId);
    const result = CustomerHistoryImportProfileService.profileRows(
      rawRows as ExtractedCustomerHistoryRow[],
      existing,
    );
    res.json({ data: result });
  } catch (e) {
    logger.error("postCustomerHistoryImportAiProfile", e);
    res.status(500).json({ error: "History import profiling failed" });
  }
}

export async function postCustomerHistoryImportAiCommit(
  req: Request,
  res: Response,
) {
  const { businessId, customerId } = req.params;
  const user = getUser(req);
  if (!user?.uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const rawRows = Array.isArray(req.body?.transactions) ?
    req.body.transactions :
    [];
  if (!rawRows.length) {
    res.status(400).json({ error: "transactions array is required" });
    return;
  }
  if (rawRows.length > 100) {
    res.status(400).json({ error: "Too many rows in one commit (max 100)" });
    return;
  }

  try {
    const ref = customerRef(businessId, customerId);
    const custSnap = await ref.get();
    if (!custSnap.exists) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    const customer = custSnap.data() || {};
    const customerName = String(customer.name || "Customer");

    const existing = await loadCustomerTransactions(businessId, customerId);
    const profiled = CustomerHistoryImportProfileService.profileRows(
      rawRows as ExtractedCustomerHistoryRow[],
      existing,
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

    const cleanRows = rows
      .filter((r) => r.status === "clean")
      .map((r) => r.transaction);
    const commitResult =
      await CustomerHistoryImportCommitService.commitExtracted({
        businessId,
        userId: user.uid,
        customerId,
        customerName,
        rows: cleanRows,
        defaultWaterTypeId,
        defaultWaterName,
        defaultUnitPrice,
      });

    const flaggedRows = rows.filter((r) => r.status === "flagged");

    await logAuditEvent("CUSTOMER_HISTORY_AI_IMPORT_COMMITTED", {
      businessId,
      customerId,
      userId: user.uid,
      totalRows: summary.total,
      importedCount: commitResult.created,
      flaggedCount: summary.flagged,
    });

    res.status(201).json({
      data: {
        summary: {
          total: summary.total,
          imported: commitResult.created,
          flagged: summary.flagged,
          failedDuringSave: commitResult.errors.length,
        },
        importedCount: commitResult.created,
        flagged: flaggedRows,
        commitErrors: commitResult.errors,
      },
    });
  } catch (e) {
    logger.error("postCustomerHistoryImportAiCommit", e);
    res.status(500).json({ error: "History import commit failed" });
  }
}
