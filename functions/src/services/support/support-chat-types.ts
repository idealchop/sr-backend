export type SupportStructuredBadgeTone = "info" | "success" | "warning" | "urgent";

export type SupportStructuredHighlightVariant = "tip" | "warning" | "action" | "note";

export type SupportStructuredStepPriority = "high" | "medium" | "low";

export type SupportStructuredBadge = {
  label: string;
  tone?: SupportStructuredBadgeTone;
};

export type SupportStructuredHighlight = {
  title: string;
  body: string;
  variant?: SupportStructuredHighlightVariant;
};

export type SupportStructuredStep = {
  title: string;
  body?: string;
  priority?: SupportStructuredStepPriority;
  tags?: string[];
};

export type SupportStructuredReply = {
  sectionLabel?: string;
  summary: string;
  badges?: SupportStructuredBadge[];
  highlights?: SupportStructuredHighlight[];
  steps?: SupportStructuredStep[];
  evidence?: string;
};

export type SupportSessionStatus = "ai_active" | "escalated" | "resolved";

export type SupportMessageRole = "user" | "ai" | "system";

export type SupportResolutionSource =
  | "greeting"
  | "human_request"
  | "knowledge_cache"
  | "deterministic_howto"
  | "workspace"
  | "gemini";

export type SupportChatSession = {
  id: string;
  businessId: string;
  userId: string;
  status: SupportSessionStatus;
  subject?: string;
  escalatedAt?: string;
  resolvedAt?: string;
  closureReason?: "user_resolved" | "inactive_timeout" | "user_away" | "daily_rollover";
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
    structuredReply?: SupportStructuredReply;
    /** Deterministic / FAQ short-circuit source when Gemini was skipped. */
    resolutionSource?: SupportResolutionSource;
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
  /** Card-style layout for the dashboard UI. */
  structured?: SupportStructuredReply;
  /** Which Buddy tier produced this reply (preflow vs Gemini). */
  resolutionSource?: SupportResolutionSource;
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
