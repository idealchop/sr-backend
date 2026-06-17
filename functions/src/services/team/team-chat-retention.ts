/** Rolling retention window for team chat messages (all participants). */
export const TEAM_CHAT_RETENTION_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function teamChatRetentionCutoffDate(now = Date.now()): Date {
  return new Date(now - TEAM_CHAT_RETENTION_DAYS * MS_PER_DAY);
}
