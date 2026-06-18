import { Request, Response } from "express";
import { generateLlmProactiveWeek } from "../services/ai/proactive-week-ai-service";
import {
  ProactiveScheduleWeekSnapshotService,
} from "../services/proactive-schedule/proactive-schedule-week-snapshot-service";

/** AI-03 — POST proactive week LLM generation */
export async function postProactiveWeekAiGenerate(req: Request, res: Response) {
  const businessId = req.params.businessId as string;
  const windowLabel =
    typeof req.body?.windowLabel === "string" ? req.body.windowLabel : "This week";
  const deterministic = Array.isArray(req.body?.deterministicSuggestions) ?
    req.body.deterministicSuggestions :
    [];

  try {
    const result = await generateLlmProactiveWeek({
      businessId,
      windowLabel,
      deterministicSuggestions: deterministic,
    });

    if (req.body?.persist === true && result.suggestions.length > 0) {
      await ProactiveScheduleWeekSnapshotService.upsert(businessId, {
        windowLabel,
        suggestions: result.suggestions,
      });
    }

    res.json({ data: result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to generate proactive week";
    res.status(500).json({ error: "Internal Server Error", message: msg });
  }
}
