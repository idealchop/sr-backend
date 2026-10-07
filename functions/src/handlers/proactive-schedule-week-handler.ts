import { Request, Response } from "express";
import {
  ProactiveScheduleWeekSnapshotService,
  type ProactiveScheduleSuggestionInput,
} from "../services/proactive-schedule/proactive-schedule-week-snapshot-service";
import { generateForecastScheduleWeekForBusiness } from
  "../services/proactive-schedule/forecast-schedule-week-generate-service";
import { forecastRecommendedAction } from "../utils/forecast-accuracy";
import { CustomerService } from "../services/customers/customer-service";

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

async function enrichRecommendedActions(
  businessId: string,
  suggestions: ProactiveScheduleSuggestionInput[],
): Promise<ProactiveScheduleSuggestionInput[]> {
  if (suggestions.length === 0) return suggestions;
  const customers = await CustomerService.getCustomersByBusiness(businessId);
  const rollupById = new Map(
    customers
      .filter((c): c is typeof c & { id: string } => Boolean(c.id))
      .map((c) => [c.id, c.forecastAccuracyRollup]),
  );
  return suggestions.map((row) => {
    const rollup = rollupById.get(row.customerId)?.[row.kind];
    if (!rollup) return row;
    return { ...row, recommendedAction: forecastRecommendedAction(rollup) };
  });
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
    if (!data) {
      res.json({ data: null });
      return;
    }
    data.suggestions = await enrichRecommendedActions(businessId, data.suggestions);
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
      source: "client_put",
    });
    const data =
      await ProactiveScheduleWeekSnapshotService.getLatest(businessId);
    res.json({ data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to save snapshot";
    res.status(500).json({ error: "Internal Server Error", message: msg });
  }
};

export const postProactiveScheduleWeekGenerate = async (
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
    const data = await generateForecastScheduleWeekForBusiness(businessId);
    if (!data) {
      res.status(403).json({
        error: "Forbidden",
        message: "Forecast week generate is available on Grow and above",
      });
      return;
    }
    res.json({ data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to generate week";
    res.status(500).json({ error: "Internal Server Error", message: msg });
  }
};

export const postProactiveScheduleWeekSuggestionCall = async (
  req: Request,
  res: Response,
) => {
  const businessId = req.params.businessId as string;
  const suggestionId = req.params.suggestionId as string;
  if (!businessId || !suggestionId) {
    res
      .status(400)
      .json({ error: "Bad Request", message: "businessId and suggestionId required" });
    return;
  }
  try {
    const current = await ProactiveScheduleWeekSnapshotService.getLatest(businessId);
    if (!current) {
      res.status(404).json({ error: "Not Found", message: "No week snapshot" });
      return;
    }
    const calledAt = new Date().toISOString();
    let found = false;
    const suggestions = current.suggestions.map((row) => {
      if (row.id !== suggestionId) return row;
      found = true;
      return { ...row, calledAt };
    });
    if (!found) {
      res.status(404).json({ error: "Not Found", message: "Suggestion not found" });
      return;
    }
    await ProactiveScheduleWeekSnapshotService.patchSuggestions(businessId, suggestions);
    const data = await ProactiveScheduleWeekSnapshotService.getLatest(businessId);
    res.json({ data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to stamp call";
    res.status(500).json({ error: "Internal Server Error", message: msg });
  }
};
