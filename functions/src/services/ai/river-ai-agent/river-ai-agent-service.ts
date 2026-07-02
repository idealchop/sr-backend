import { answerDashboardQuestion } from "../ai-dashboard-qa-service";
import { RIVER_AI_AGENT_WRITE_TOOLS, type RiverAiAgentTurnResult } from "./river-ai-agent-types";
import { parseRiverAiAgentIntent } from "./river-ai-agent-intent";
import {
  getCustomerForAgent,
  getTransactionForAgent,
  listCatalogForAgent,
  listCustomersForAgent,
  listInventoryForAgent,
  listTransactionsForAgent,
} from "./river-ai-agent-read-tools";
import { savePendingAction } from "./river-ai-agent-pending-store";
import { buildWriteDraft } from "./river-ai-agent-write-drafts";

function isWriteTool(tool: string): boolean {
  return (RIVER_AI_AGENT_WRITE_TOOLS as readonly string[]).includes(tool);
}

function formatListReply(tool: string, total: number, shown: number): string {
  if (total === 0) return "Walang resulta para sa filter na iyan.";
  return `Nakita ko **${total}** row(s). Showing ${shown}.`;
}

export async function runRiverAiAgentTurn(args: {
  businessId: string;
  userId: string;
  message: string;
  businessName?: string;
}): Promise<RiverAiAgentTurnResult> {
  const intent = await parseRiverAiAgentIntent({
    message: args.message,
    businessName: args.businessName,
  });

  if (intent.clarifyingQuestion && intent.tool === "chat.answer") {
    return {
      reply: intent.clarifyingQuestion,
      tool: intent.tool,
      clarifyingQuestion: intent.clarifyingQuestion,
    };
  }

  const { tool, parameters } = intent;

  if (tool === "chat.answer") {
    const question = String(parameters.question || args.message);
    const qa = await answerDashboardQuestion({ businessId: args.businessId, question });
    return {
      reply: qa.answer,
      tool,
      data: qa,
    };
  }

  if (tool === "customer.list") {
    const { rows, total } = await listCustomersForAgent(args.businessId, parameters);
    return {
      reply: formatListReply(tool, total, rows.length),
      tool,
      rows,
      total,
    };
  }

  if (tool === "customer.get") {
    const { rows, total } = await getCustomerForAgent(args.businessId, parameters);
    return {
      reply: total ? "Customer profile ready." : "Customer not found.",
      tool,
      rows,
      total,
    };
  }

  if (tool === "transaction.list") {
    const { rows, total } = await listTransactionsForAgent(args.businessId, parameters);
    return {
      reply: formatListReply(tool, total, rows.length),
      tool,
      rows,
      total,
    };
  }

  if (tool === "transaction.get") {
    const { rows, total } = await getTransactionForAgent(args.businessId, parameters);
    return {
      reply: total ? "Transaction details ready." : "Transaction not found.",
      tool,
      rows,
      total,
    };
  }

  if (tool === "inventory.list") {
    const { rows, total } = await listInventoryForAgent(args.businessId, parameters);
    return {
      reply: formatListReply(tool, total, rows.length),
      tool,
      rows,
      total,
    };
  }

  if (tool === "catalog.list") {
    const { rows, total } = await listCatalogForAgent(args.businessId);
    return {
      reply: `Catalog has ${total} entries.`,
      tool,
      rows,
      total,
    };
  }

  if (isWriteTool(tool)) {
    const draft = await buildWriteDraft({
      businessId: args.businessId,
      tool,
      parameters,
    });
    if (!draft) {
      return {
        reply:
          intent.clarifyingQuestion ||
          "Kulang ang detalye — paki-specify customer name, amount, o reference ID.",
        tool: "chat.answer",
        clarifyingQuestion: intent.clarifyingQuestion,
      };
    }
    const pendingAction = await savePendingAction({
      businessId: args.businessId,
      userId: args.userId,
      tool,
      payload: draft.payload,
      preview: draft.preview,
    });
    return {
      reply: `Draft ready: **${draft.preview.title}**. Review below and tap **Confirm** to save.`,
      tool,
      pendingAction,
    };
  }

  return {
    reply: "Hindi ko naintindihan — subukan mong i-list, i-add, o i-update gamit ang specific names.",
    tool: "chat.answer",
  };
}
