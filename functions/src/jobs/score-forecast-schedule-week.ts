import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { scoreForecastScheduleWeekForAllBusinesses } from
  "../services/proactive-schedule/forecast-schedule-week-score-service";

/**
 * Daily 23:30 Asia/Manila: match predicted visits to ledger tickets (±1 day) and score.
 */
export async function runScoreForecastScheduleWeek(): Promise<void> {
  const result = await scoreForecastScheduleWeekForAllBusinesses();
  logger.info("scoreForecastScheduleWeek job complete", result);
}

export const scoreForecastScheduleWeek = onSchedule(
  {
    schedule: "every day 23:30",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "1GiB",
    timeoutSeconds: 540,
  },
  runScoreForecastScheduleWeek,
);
