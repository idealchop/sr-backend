import { Response } from "express";

/**
 * Temporary SmartRefill AI kill switch for intel / scan tools.
 * Flip to `false` (or set SMARTREFILL_AI_MAINTENANCE=0) when bringing tools back.
 *
 * Allowed while on: River AI Buddy, Buddy ops agent, file imports.
 * Duplicate *detect* stays available (heuristics, no Gemini).
 */
export const SMARTREFILL_AI_UNDER_MAINTENANCE =
  process.env.SMARTREFILL_AI_MAINTENANCE !== "0";

export const AI_UNDER_MAINTENANCE_MESSAGE =
  "River AI tools are under maintenance. River AI Buddy still works. Customer, history, and inventory imports still work. Duplicate detection is available without AI.";

/** Gemini `operation` values still allowed during maintenance. */
export const AI_MAINTENANCE_ALLOWED_OPERATIONS = new Set([
  "support.buddy",
  "river_ai_agent.intent",
  "customer.import.text",
  "customer.import.image",
  "customer_history.import.text",
  "customer_history.import.image",
  "inventory.import.text",
  "inventory.import.image",
]);

export class AiUnderMaintenanceError extends Error {
  readonly code = "AI_UNDER_MAINTENANCE" as const;
  constructor(message = AI_UNDER_MAINTENANCE_MESSAGE) {
    super(message);
    this.name = "AiUnderMaintenanceError";
  }
}

export function isAiOperationAllowedDuringMaintenance(
  operation: string | undefined,
): boolean {
  if (!SMARTREFILL_AI_UNDER_MAINTENANCE) return true;
  const op = (operation || "").trim();
  return AI_MAINTENANCE_ALLOWED_OPERATIONS.has(op);
}

/** Throws when SmartRefill AI is under maintenance (non-allowlisted features). */
export function assertAiFeatureAvailable(
  operation?: string,
): void {
  if (isAiOperationAllowedDuringMaintenance(operation)) return;
  throw new AiUnderMaintenanceError();
}

/** Map maintenance errors to HTTP 503. Returns true when handled. */
export function sendAiUnderMaintenance(
  res: Response,
  error: unknown,
): boolean {
  if (!(error instanceof AiUnderMaintenanceError)) return false;
  res.status(503).json({
    error: error.message,
    code: error.code,
    remark: "under_maintenance",
  });
  return true;
}
