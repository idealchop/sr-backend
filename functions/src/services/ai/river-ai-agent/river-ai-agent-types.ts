/** River AI ops agent — tool ids and shared payloads. */

export const RIVER_AI_AGENT_READ_TOOLS = [
  "customer.list",
  "customer.get",
  "transaction.list",
  "transaction.get",
  "inventory.list",
  "catalog.list",
  "rider.list",
  "report.today_summary",
] as const;

export const RIVER_AI_AGENT_WRITE_TOOLS = [
  "customer.create",
  "customer.update",
  "customer.set_status",
  "transaction.create",
  "transaction.update",
  "transaction.set_fulfillment_status",
  "transaction.record_payment",
  "transaction.assign_rider",
  "transaction.report_collection_issue",
  "inventory.create",
  "inventory.update",
  "inventory.adjust_stock",
  "catalog.upsert_water_type",
  "catalog.upsert_inventory_category",
  "catalog.upsert_expense_category",
] as const;

export const RIVER_AI_AGENT_TOOLS = [
  "chat.answer",
  ...RIVER_AI_AGENT_READ_TOOLS,
  ...RIVER_AI_AGENT_WRITE_TOOLS,
] as const;

export type RiverAiAgentToolId = (typeof RIVER_AI_AGENT_TOOLS)[number];

export type RiverAiAgentListRow = {
  id: string;
  label: string;
  sublabel?: string;
  meta?: Record<string, string | number | boolean | null>;
};

export type RiverAiAgentPreviewField = {
  label: string;
  value: string;
};

export type RiverAiAgentPendingAction = {
  id: string;
  businessId: string;
  userId: string;
  tool: RiverAiAgentToolId;
  payload: Record<string, unknown>;
  preview: {
    title: string;
    summary: string;
    fields: RiverAiAgentPreviewField[];
    warnings?: string[];
  };
  createdAt: string;
  expiresAt: string;
};

export type RiverAiAgentIntentResult = {
  tool: RiverAiAgentToolId;
  parameters: Record<string, unknown>;
  confidence: number;
  clarifyingQuestion?: string;
  replyHint?: string;
};

export type RiverAiAgentTurnResult = {
  reply: string;
  tool: RiverAiAgentToolId;
  /** Read results or chat answer */
  data?: unknown;
  /** Rows for list tools */
  rows?: RiverAiAgentListRow[];
  total?: number;
  /** Write draft awaiting confirm */
  pendingAction?: RiverAiAgentPendingAction;
  clarifyingQuestion?: string;
};

export type RiverAiAgentConfirmResult = {
  success: boolean;
  summary: string;
  entityIds?: string[];
  errors?: string[];
};

export type RiverAiAgentTransactionSubtype =
  | "delivery"
  | "walkin"
  | "walkin_with_direct_sale"
  | "direct_sale"
  | "expense"
  | "collection";
