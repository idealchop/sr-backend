import { AiToolRunService, type AiToolId, AI_TOOL_IDS } from "./ai-tool-run-service";

export type WorkflowStepId =
  | "morning_brief"
  | "collections_pulse"
  | "dispatch_health"
  | "warehouse_risk"
  | "retention_pulse"
  | "plant_health";

export type WorkflowRunResult = {
  workflowId: string;
  steps: Array<{
    tool: WorkflowStepId;
    runId: string;
    title: string;
    summary: string;
    riskLevel: string;
  }>;
  combinedSummary: string;
};

const WORKFLOW_PRESETS: Record<string, WorkflowStepId[]> = {
  monday_routine: ["morning_brief", "collections_pulse", "dispatch_health"],
  collections_focus: ["collections_pulse", "retention_pulse"],
  plant_ops: ["plant_health", "warehouse_risk"],
};

function isWorkflowTool(v: string): v is WorkflowStepId {
  return (AI_TOOL_IDS as readonly string[]).includes(v);
}

/**
 * AI-49 — agentic multi-step workflow runner stub.
 * Each step is credit-gated separately at the API layer; no silent mutations.
 */
export async function runAiWorkflow(params: {
  businessId: string;
  uid: string;
  workflowId?: string;
  steps?: string[];
}): Promise<WorkflowRunResult> {
  const workflowId = params.workflowId || "monday_routine";
  const stepIds =
    Array.isArray(params.steps) && params.steps.length > 0 ?
      params.steps.filter(isWorkflowTool) :
      WORKFLOW_PRESETS[workflowId] || WORKFLOW_PRESETS.monday_routine;

  const steps: WorkflowRunResult["steps"] = [];
  for (const tool of stepIds) {
    const run = await AiToolRunService.executeTool({
      businessId: params.businessId,
      uid: params.uid,
      tool: tool as AiToolId,
    });
    steps.push({
      tool,
      runId: run.id,
      title: run.title,
      summary: run.summary,
      riskLevel: run.riskLevel,
    });
  }

  const combinedSummary =
    steps.length === 0 ?
      "No workflow steps executed." :
      steps.map((s, i) => `${i + 1}. ${s.title}: ${s.summary}`).join(" ");

  return { workflowId, steps, combinedSummary };
}
