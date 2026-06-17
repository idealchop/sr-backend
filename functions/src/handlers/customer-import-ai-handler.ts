import { Request, Response } from "express";
import { db, FieldValue } from "../config/firebase-admin";
import {
  logger,
  logAuditEvent,
} from "../services/observability/logging/logger";
import { CustomerService } from "../services/customers/customer-service";
import { resolveCustomerLocationWithGeocode } from "../services/customers/customer-address-geocode";
import {
  CustomerImportFromFileService,
  type ExtractedCustomerDraft,
} from "../services/ai/customer-import-from-file-service";
import { CustomerImportProfileService } from
  "../services/customers/customer-import-profile-service";

function getUser(req: Request) {
  return (req as { user?: { uid: string } }).user;
}

export async function getCustomerImportAiEligibility(
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
    const freeUsed = !!snap.data()?.customerImportAiFreeUsed;
    res.json({
      data: {
        freeImportAvailable: !freeUsed,
      },
    });
  } catch (e) {
    logger.error("getCustomerImportAiEligibility", e);
    res.status(500).json({ error: "Failed to read import eligibility" });
  }
}

export async function postCustomerImportAiParse(req: Request, res: Response) {
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
    const freeUsedBefore = !!bizSnap.data()?.customerImportAiFreeUsed;

    const data =
      await CustomerImportFromFileService.extractFromDataUri(fileDataUri);

    if (!freeUsedBefore) {
      await bizRef.update({
        customerImportAiFreeUsed: true,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    res.json({ data });
  } catch (e) {
    logger.error("postCustomerImportAiParse", e);
    res.status(500).json({ error: "AI import preview failed" });
  }
}

export async function postCustomerImportAiProfile(req: Request, res: Response) {
  const { businessId } = req.params;
  const rawRows = Array.isArray(req.body?.customers) ? req.body.customers : [];
  if (!rawRows.length) {
    res.status(400).json({ error: "customers array is required" });
    return;
  }
  if (rawRows.length > 100) {
    res.status(400).json({ error: "Too many rows in one import (max 100)" });
    return;
  }

  try {
    const result = await CustomerImportProfileService.profileImport(
      businessId,
      rawRows as ExtractedCustomerDraft[],
    );
    res.json({ data: result });
  } catch (e) {
    logger.error("postCustomerImportAiProfile", e);
    res.status(500).json({ error: "Import profiling failed" });
  }
}

async function toAddPayload(row: ExtractedCustomerDraft) {
  const location = await resolveCustomerLocationWithGeocode({
    address: row.address,
    latitude:
      typeof row.latitude === "number" && Number.isFinite(row.latitude) ?
        row.latitude :
        undefined,
    longitude:
      typeof row.longitude === "number" && Number.isFinite(row.longitude) ?
        row.longitude :
        undefined,
  });

  return {
    name: row.name,
    phone: row.phone,
    address: location.address,
    ...(location.latitude != null && location.longitude != null ?
      { latitude: location.latitude, longitude: location.longitude } :
      {}),
    email: row.email || undefined,
    type: row.type || "residential",
    companyName: row.companyName || undefined,
    isDeliveryEnabled: row.isDeliveryEnabled !== false,
    isCollectionEnabled: !!row.isCollectionEnabled,
  };
}

export async function postCustomerImportAiCommit(req: Request, res: Response) {
  const { businessId } = req.params;
  const user = getUser(req);
  if (!user?.uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const rawRows = Array.isArray(req.body?.customers) ? req.body.customers : [];
  if (!rawRows.length) {
    res.status(400).json({ error: "customers array is required" });
    return;
  }
  if (rawRows.length > 100) {
    res.status(400).json({ error: "Too many rows in one commit (max 100)" });
    return;
  }

  try {
    const bizSnap = await db.collection("businesses").doc(businessId).get();
    if (!bizSnap.exists) {
      res.status(404).json({ error: "Business not found" });
      return;
    }

    const profiled = await CustomerImportProfileService.profileImport(
      businessId,
      rawRows as ExtractedCustomerDraft[],
    );

    const { limitCheck, rows, summary } = profiled;

    if (limitCheck.totalExceedsLimit) {
      res.status(403).json({
        error: "CUSTOMER_LIMIT_EXCEEDED",
        message:
          "This import would exceed your plan customer limit. Remove some rows from your file " +
          "or upgrade your subscription under Account → Subscription.",
        data: {
          limitCheck,
          summary,
          rows: rows.filter((r) => r.status === "flagged"),
          imported: [],
        },
      });
      return;
    }

    if (!limitCheck.canImportClean || summary.clean === 0) {
      const flaggedOnly = summary.flagged === summary.total;
      res.status(400).json({
        error: flaggedOnly ? "NO_CLEAN_ROWS" : "CUSTOMER_LIMIT_EXCEEDED",
        message: flaggedOnly ?
          "No rows passed data checks. Fix flagged issues or remove duplicates, then try again." :
          "Not enough customer slots left on your plan for the clean rows in this file.",
        data: {
          limitCheck,
          summary,
          rows,
          imported: [],
        },
      });
      return;
    }

    const created: { id: string; name: string; index: number }[] = [];
    const importErrors: { index: number; message: string }[] = [];

    for (const row of rows) {
      if (row.status !== "clean") continue;
      try {
        const payload = await toAddPayload(row.customer);
        const c = await CustomerService.addCustomer(businessId, payload);
        if (c.id) {
          created.push({ id: c.id, name: c.name, index: row.index });
        }
      } catch (err) {
        logger.warn("postCustomerImportAiCommit row failed", {
          businessId,
          index: row.index,
          err,
        });
        importErrors.push({
          index: row.index,
          message: "Could not create customer",
        });
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const flaggedRows = rows.filter(
      (r) =>
        r.status === "flagged" || importErrors.some((e) => e.index === r.index),
    );

    await logAuditEvent("CUSTOMER_AI_IMPORT_COMMITTED", {
      businessId,
      userId: user.uid,
      totalRows: summary.total,
      importedCount: created.length,
      flaggedCount: summary.flagged + importErrors.length,
      sampleNames: created.slice(0, 5).map((c) => c.name),
    });

    res.status(201).json({
      data: {
        limitCheck,
        summary: {
          total: summary.total,
          imported: created.length,
          flagged: summary.flagged + importErrors.length,
          failedDuringSave: importErrors.length,
        },
        imported: created,
        flagged: [
          ...rows.filter((r) => r.status === "flagged"),
          ...importErrors.map((e) => {
            const src = rows.find((r) => r.index === e.index);
            return {
              index: e.index,
              customer: src?.customer || { name: "", phone: "", address: "" },
              status: "flagged" as const,
              issues: [e.message, ...(src?.issues || [])],
            };
          }),
        ],
        importErrors,
      },
    });
  } catch (e) {
    logger.error("postCustomerImportAiCommit", e);
    res.status(500).json({ error: "Import commit failed" });
  }
}
