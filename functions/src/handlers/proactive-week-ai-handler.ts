import { Request, Response } from "express";
import { generateLlmProactiveWeek } from "../services/ai/proactive-week-ai-service";
import {
  ProactiveScheduleWeekSnapshotService,
  type ProactiveScheduleSuggestionInput,
} from "../services/proactive-schedule/proactive-schedule-week-snapshot-service";

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function parseWindowDate(raw: unknown, fallback: Date): Date {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? fallback : startOfDay(d);
}

function isValidSuggestionInput(x: unknown): x is ProactiveScheduleSuggestionInput {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.customerId === "string" &&
    typeof o.customerName === "string" &&
    typeof o.scheduledDate === "string" &&
    (o.kind === "delivery" || o.kind === "collection") &&
    Array.isArray(o.refillItems) &&
    Array.isArray(o.returnContainers) &&
    typeof o.rationale === "string"
  );
}

/** AI-03 — POST proactive week LLM generation */
export async function postProactiveWeekAiGenerate(req: Request, res: Response) {
  const businessId = req.params.businessId as string;
  const windowLabel =
    typeof req.body?.windowLabel === "string" ? req.body.windowLabel : "This week";
  const now = startOfDay(new Date());
  const windowStart = parseWindowDate(req.body?.windowStart, now);
  const windowEnd = parseWindowDate(req.body?.windowEnd, addDays(now, 6));
  const deterministic = (Array.isArray(req.body?.deterministicSuggestions) ?
    req.body.deterministicSuggestions :
    []
  ).filter(isValidSuggestionInput);

  try {
    const result = await generateLlmProactiveWeek({
      businessId,
      windowLabel,
      windowStart,
      windowEnd,
      deterministicSuggestions: deterministic,
    });

    if (req.body?.persist === true && result.suggestions.length > 0) {
      await ProactiveScheduleWeekSnapshotService.upsert(businessId, {
        windowLabel,
        suggestions: result.suggestions,
        aiSummary: result.summary,
      });
    }

    const snapshot =
      req.body?.persist === true ?
        await ProactiveScheduleWeekSnapshotService.getLatest(businessId) :
        null;

    res.json({
      data: {
        ...result,
        snapshot,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to generate proactive week";
    res.status(500).json({ error: "Internal Server Error", message: msg });
  }
}
