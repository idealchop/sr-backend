import { describe, expect, it } from "vitest";
import { parseFastRiverAiAgentIntent } from "../../../../services/ai/river-ai-agent/river-ai-agent-intent";

describe("parseFastRiverAiAgentIntent", () => {
  it("routes list customers without Gemini", () => {
    expect(parseFastRiverAiAgentIntent("list customers")?.tool).toBe("customer.list");
    expect(parseFastRiverAiAgentIntent("show all suki")?.tool).toBe("customer.list");
    expect(parseFastRiverAiAgentIntent("show customers")?.tool).toBe("customer.list");
  });

  it("routes customer lookup by name", () => {
    const intent = parseFastRiverAiAgentIntent("show customer Juan Santos");
    expect(intent?.tool).toBe("customer.get");
    expect(intent?.parameters.search).toBe("Juan Santos");
  });

  it("routes customers with balance", () => {
    const intent = parseFastRiverAiAgentIntent("customers with balance");
    expect(intent?.tool).toBe("customer.list");
    expect(intent?.parameters.hasBalance).toBe(true);
  });

  it("routes today's deliveries", () => {
    const intent = parseFastRiverAiAgentIntent("today's deliveries");
    expect(intent?.tool).toBe("transaction.list");
    expect(intent?.parameters.type).toBe("delivery");
    expect(intent?.parameters.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("routes unpaid transactions", () => {
    const intent = parseFastRiverAiAgentIntent("unpaid transactions");
    expect(intent?.tool).toBe("transaction.list");
    expect(intent?.parameters.unpaid).toBe(true);
  });

  it("routes low stock inventory", () => {
    const intent = parseFastRiverAiAgentIntent("show low stock inventory");
    expect(intent?.tool).toBe("inventory.list");
    expect(intent?.parameters.lowStock).toBe(true);
  });
});
