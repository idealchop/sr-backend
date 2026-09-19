import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { runInactiveAccountDeactivationScan } from
  "../services/notifications/inactive-account-deactivation-service";

/** Daily scan: deactivate workspaces unused for 30+ days and email the owner. */
export async function runInactiveAccountDeactivation(): Promise<void> {
  const result = await runInactiveAccountDeactivationScan();
  logger.info("inactiveAccountDeactivation complete", result);
}

export const inactiveAccountDeactivation = onSchedule(
  {
    schedule: "every day 08:00",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "512MiB",
    timeoutSeconds: 540,
    secrets: ["SMARTREFILL_BREVO_API_KEY"],
  },
  runInactiveAccountDeactivation,
);
