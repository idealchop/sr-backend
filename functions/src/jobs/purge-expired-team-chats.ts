import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { purgeExpiredTeamChatContent } from "../services/team/team-chat-purge-service";
import { TEAM_CHAT_RETENTION_DAYS } from "../services/team/team-chat-retention";

/**
 * Permanently deletes team chat messages older than the retention window
 * and removes conversation docs that no longer have messages.
 */
export const purgeExpiredTeamChats = onSchedule(
  {
    schedule: "every day 03:30",
    timeZone: "Asia/Manila",
    region: "asia-southeast1",
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async () => {
    const result = await purgeExpiredTeamChatContent();
    logger.info("purgeExpiredTeamChats complete", {
      retentionDays: TEAM_CHAT_RETENTION_DAYS,
      ...result,
    });
  },
);
