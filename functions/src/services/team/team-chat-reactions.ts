export const TEAM_CHAT_REACTIONS = [
  "heart",
  "like",
  "dislike",
  "disgusting",
  "awe",
  "happy",
  "sad",
] as const;

export type TeamChatReactionType = (typeof TEAM_CHAT_REACTIONS)[number];

export function isTeamChatReaction(value: unknown): value is TeamChatReactionType {
  return typeof value === "string" &&
    TEAM_CHAT_REACTIONS.includes(value as TeamChatReactionType);
}
