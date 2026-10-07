import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { scoreForecastScheduleWeekForBusiness } from
  "../services/proactive-schedule/forecast-schedule-week-score-service";
import {
  generateForecastScheduleWeekForBusiness,
  listAllBusinessIds,
} from "../services/proactive-schedule/forecast-schedule-week-generate-service";
import { ProactiveScheduleWeekSnapshotService } from
  "../services/proactive-schedule/proactive-schedule-week-snapshot-service";

/**
 * Sunday 21:00 Asia/Manila: score the closing week, then write the next heuristic snapshot.
 * No Gemini. Owner still Save/Call from Forecast.
 */
export async function runGenerateForecastScheduleWeek(): Promise<void> {
  const ids = await listAllBusinessIds();
  let generated = 0;
  for (const businessId of ids) {
    try {
      await scoreForecastScheduleWeekForBusiness(businessId);
      const scored = await ProactiveScheduleWeekSnapshotService.getLatest(businessId);
      const lastWeekAccuracy = scored ?
        ProactiveScheduleWeekSnapshotService.lastWeekAccuracyFromSuggestions(
          scored.suggestions,
          scored.generatedAt,
        ) :
        undefined;
      const snap = await generateForecastScheduleWeekForBusiness(businessId, {
        lastWeekAccuracy,
      });
      if (snap) generated += 1;
    } catch (error) {
      logger.error("generateForecastScheduleWeek business failed", { businessId, error });
    }
  }
  logger.info("generateForecastScheduleWeek job complete", {
    businesses: ids.length,
    generated,
  });
}

export const generateForecastScheduleWeek = onSchedule(
  {
    schedule: "every sunday 21:00",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  runGenerateForecastScheduleWeek,
);
