export type SupportSessionStatus = "ai_active" | "escalated" | "resolved";

export type SupportMessageRole = "user" | "ai" | "system";

export type SupportChatSession = {
  id: string;
  businessId: string;
  userId: string;
  status: SupportSessionStatus;
  subject?: string;
  escalatedAt?: string;
  resolvedAt?: string;
  closureReason?: "user_resolved" | "inactive_timeout" | "user_away";
  feedbackRating?: number;
  feedbackComment?: string;
  feedbackSubmittedAt?: string;
  createdAt: string;
  updatedAt: string;
  /** Last AI turn asked "was this helpful?" */
  awaitingSatisfaction?: boolean;
  /** User confirmed issue is resolved */
  resolutionConfirmed?: boolean;
  /** Rolling session memory so follow-up turns stay contextual (not repetitive). */
  conversationSummary?: string;
};

export type SupportMessageAttachment = {
  url: string;
  fileName?: string;
  mimeType?: string;
};

export type SupportChatMessage = {
  id: string;
  role: SupportMessageRole;
  text: string;
  createdAt: string;
  meta?: {
    askSatisfaction?: boolean;
    suggestHuman?: boolean;
    suggestResolve?: boolean;
    attachments?: SupportMessageAttachment[];
    presencePrompt?: boolean;
    inactiveClose?: boolean;
  };
};

export type SupportAiTurnResult = {
  reply: string;
  askSatisfaction: boolean;
  suggestHuman: boolean;
  suggestResolve: boolean;
  detectedSatisfied: boolean;
  detectedDissatisfied: boolean;
  detectedHumanRequest: boolean;
  /** User question is unrelated to water refilling, water stations, or Smart Refill. */
  topicOutOfScope?: boolean;
  /** Short memory of this session for the next turn (issues, names, steps tried). */
  sessionSummary?: string;
};

export type SupportAiKnowledgeDoc = {
  id: string;
  question: string;
  answer: string;
  sessionId: string;
  messageId?: string;
  createdAt: string;
  createdBy: string;
};
