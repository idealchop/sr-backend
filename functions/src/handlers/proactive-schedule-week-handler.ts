import { Request, Response } from "express";
import {
  ProactiveScheduleWeekSnapshotService,
  type ProactiveScheduleSuggestionInput,
} from "../services/proactive-schedule/proactive-schedule-week-snapshot-service";

function isValidSuggestionRow(
  x: unknown,
): x is ProactiveScheduleSuggestionInput {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (
    typeof o.id !== "string" ||
    typeof o.customerId !== "string" ||
    typeof o.customerName !== "string"
  ) {
    return false;
  }
  if (typeof o.scheduledDate !== "string") return false;
  if (o.kind !== "delivery" && o.kind !== "collection") return false;
  if (
    !Array.isArray(o.refillItems) ||
    !Array.isArray(o.returnContainers) ||
    typeof o.rationale !== "string"
  ) {
    return false;
  }
  return true;
}

export const getProactiveScheduleWeekSnapshot = async (
  req: Request,
  res: Response,
) => {
  const businessId = req.params.businessId as string;
  if (!businessId) {
    res
      .status(400)
      .json({ error: "Bad Request", message: "businessId required" });
    return;
  }
  try {
    const data =
      await ProactiveScheduleWeekSnapshotService.getLatest(businessId);
    res.json({ data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to load snapshot";
    res.status(500).json({ error: "Internal Server Error", message: msg });
  }
};

export const putProactiveScheduleWeekSnapshot = async (
  req: Request,
  res: Response,
) => {
  const businessId = req.params.businessId as string;
  if (!businessId) {
    res
      .status(400)
      .json({ error: "Bad Request", message: "businessId required" });
    return;
  }
  const body = req.body as { windowLabel?: string; suggestions?: unknown[] };
  const windowLabel =
    typeof body.windowLabel === "string" ? body.windowLabel : "";
  const raw = Array.isArray(body.suggestions) ? body.suggestions : [];
  const suggestions = raw.filter(isValidSuggestionRow);
  if (raw.length > 0 && suggestions.length === 0) {
    res
      .status(400)
      .json({ error: "Bad Request", message: "Invalid suggestions payload" });
    return;
  }
  try {
    await ProactiveScheduleWeekSnapshotService.upsert(businessId, {
      windowLabel,
      suggestions,
    });
    const data =
      await ProactiveScheduleWeekSnapshotService.getLatest(businessId);
    res.json({ data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to save snapshot";
    res.status(500).json({ error: "Internal Server Error", message: msg });
  }
};
