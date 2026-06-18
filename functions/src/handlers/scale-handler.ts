import { Request, Response } from "express";
import { buildOwnerHubRollup } from "../services/scale/owner-hub-rollup-service";
import { cloneStationTemplate } from "../services/scale/station-clone-service";
import { buildAccountantExportPack } from "../services/scale/accountant-export-service";
import { StaffCertificationService } from "../services/scale/staff-certification-service";
import {
  PartnerWebhookService,
} from "../services/scale/partner-webhook-service";
import {
  getRegionalBenchmark,
  setRegionalBenchmarkOptIn,
} from "../services/scale/regional-benchmark-service";
import { logger } from "../services/observability/logging/logger";
import { manilaDateKey } from "../utils/philippine-datetime";
import { assertExtraBusinessAddonAccess } from "../utils/extra-business-addon-access";
import { assertScalePlatformAccess } from "../utils/scale-plan-access";

async function requireExtraBusinessAddon(req: Request, res: Response): Promise<string | null> {
  const businessId = String(req.params.businessId || "").trim();
  if (!businessId) {
    res.status(400).json({ error: "businessId is required" });
    return null;
  }
  if (!(await assertExtraBusinessAddonAccess(businessId, res))) {
    return null;
  }
  return businessId;
}

async function requireScalePlan(req: Request, res: Response): Promise<string | null> {
  const businessId = String(req.params.businessId || "").trim();
  if (!businessId) {
    res.status(400).json({ error: "businessId is required" });
    return null;
  }
  if (!(await assertScalePlatformAccess(businessId, res))) {
    return null;
  }
  return businessId;
}

/** SC-01 — GET /business/:id/scale/rollup */
export async function getScaleRollup(req: Request, res: Response) {
  const user = (req as { user?: { uid: string } }).user;
  if (!user?.uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const businessId = await requireExtraBusinessAddon(req, res);
  if (!businessId) return;
  const periodDays = Math.min(90, Math.max(7, Number(req.query.periodDays) || 30));
  try {
    const data = await buildOwnerHubRollup(user.uid, periodDays);
    res.json({ data });
  } catch (e) {
    logger.error("getScaleRollup failed", e);
    res.status(500).json({ error: "Failed to build rollup" });
  }
}

/** SC-02 — POST /business/:id/scale/clone */
export async function postScaleClone(req: Request, res: Response) {
  const businessId = await requireExtraBusinessAddon(req, res);
  if (!businessId) return;
  const user = (req as { user?: { uid: string } }).user;
  if (!user?.uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const data = await cloneStationTemplate({
      sourceBusinessId: businessId,
      ownerId: user.uid,
      options: req.body,
    });
    res.status(201).json({ data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "FORBIDDEN" || msg === "SOURCE_NOT_FOUND") {
      res.status(403).json({ error: msg });
      return;
    }
    logger.error("postScaleClone failed", e);
    res.status(500).json({ error: "Failed to clone station" });
  }
}

/** SC-05 — GET /business/:id/scale/accountant-export */
export async function getAccountantExport(req: Request, res: Response) {
  const businessId = await requireScalePlan(req, res);
  if (!businessId) return;
  const month =
    typeof req.query.month === "string" ?
      req.query.month :
      manilaDateKey(new Date()).slice(0, 7);
  const format = req.query.format === "pdf" ? "pdf" : "csv";
  try {
    const data = await buildAccountantExportPack({ businessId, month, format });
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="accountant-${month}.csv"`,
      );
      res.send(data.csvContent);
      return;
    }
    res.json({ data });
  } catch (e) {
    logger.error("getAccountantExport failed", e);
    res.status(500).json({ error: "Failed to build export" });
  }
}

export async function listStaffCertifications(req: Request, res: Response) {
  const businessId = await requireScalePlan(req, res);
  if (!businessId) return;
  try {
    const tracks = StaffCertificationService.listTracks();
    const certifications = await StaffCertificationService.list(businessId);
    res.json({ data: { tracks, certifications } });
  } catch (e) {
    logger.error("listStaffCertifications failed", e);
    res.status(500).json({ error: "Failed to list certifications" });
  }
}

export async function createStaffCertification(req: Request, res: Response) {
  const businessId = await requireScalePlan(req, res);
  if (!businessId) return;
  const { userId, trackId, trackLabel } = req.body || {};
  if (!userId || !trackId) {
    res.status(400).json({ error: "userId and trackId required" });
    return;
  }
  try {
    const data = await StaffCertificationService.create(businessId, {
      userId: String(userId),
      trackId: String(trackId),
      trackLabel: String(trackLabel || ""),
    });
    res.status(201).json({ data });
  } catch (e) {
    logger.error("createStaffCertification failed", e);
    res.status(500).json({ error: "Failed to create certification" });
  }
}

export async function completeStaffCertification(req: Request, res: Response) {
  const businessId = await requireScalePlan(req, res);
  if (!businessId) return;
  const { certId } = req.params;
  const score = req.body?.score != null ? Number(req.body.score) : undefined;
  try {
    await StaffCertificationService.complete(businessId, certId, score);
    res.json({ ok: true });
  } catch (e) {
    logger.error("completeStaffCertification failed", e);
    res.status(500).json({ error: "Failed to complete certification" });
  }
}

export async function deleteStaffCertification(req: Request, res: Response) {
  const businessId = await requireScalePlan(req, res);
  if (!businessId) return;
  const { certId } = req.params;
  try {
    await StaffCertificationService.remove(businessId, certId);
    res.json({ ok: true });
  } catch (e) {
    logger.error("deleteStaffCertification failed", e);
    res.status(500).json({ error: "Failed to delete certification" });
  }
}

export async function listPartnerWebhooks(req: Request, res: Response) {
  const businessId = await requireScalePlan(req, res);
  if (!businessId) return;
  try {
    const data = await PartnerWebhookService.list(businessId);
    res.json({ data });
  } catch (e) {
    logger.error("listPartnerWebhooks failed", e);
    res.status(500).json({ error: "Failed to list webhooks" });
  }
}

export async function registerPartnerWebhook(req: Request, res: Response) {
  const businessId = await requireScalePlan(req, res);
  if (!businessId) return;
  const url = typeof req.body?.url === "string" ? req.body.url : "";
  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  if (!url) {
    res.status(400).json({ error: "url required" });
    return;
  }
  try {
    const data = await PartnerWebhookService.register(businessId, { url, events });
    res.status(201).json({ data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "INVALID_URL") {
      res.status(400).json({ error: msg });
      return;
    }
    logger.error("registerPartnerWebhook failed", e);
    res.status(500).json({ error: "Failed to register webhook" });
  }
}

export async function getRegionalBenchmarkHandler(req: Request, res: Response) {
  const businessId = await requireScalePlan(req, res);
  if (!businessId) return;
  try {
    const data = await getRegionalBenchmark(businessId);
    res.json({ data });
  } catch (e) {
    logger.error("getRegionalBenchmark failed", e);
    res.status(500).json({ error: "Failed to load benchmark" });
  }
}

export async function patchRegionalBenchmarkOptIn(req: Request, res: Response) {
  const businessId = await requireScalePlan(req, res);
  if (!businessId) return;
  const optIn = req.body?.optIn === true;
  const regionKey =
    typeof req.body?.regionKey === "string" ? req.body.regionKey : undefined;
  try {
    await setRegionalBenchmarkOptIn(businessId, optIn, regionKey);
    const data = await getRegionalBenchmark(businessId);
    res.json({ data });
  } catch (e) {
    logger.error("patchRegionalBenchmarkOptIn failed", e);
    res.status(500).json({ error: "Failed to update opt-in" });
  }
}
