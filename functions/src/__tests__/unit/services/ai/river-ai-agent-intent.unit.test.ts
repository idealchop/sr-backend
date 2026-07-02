import { describe, expect, it } from "vitest";
import {
  parseFastRiverAiAgentIntent,
  parseFastWriteRiverAiAgentIntent,
} from "../../../../services/ai/river-ai-agent/river-ai-agent-intent";

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

  it("routes today's revenue summary", () => {
    expect(parseFastRiverAiAgentIntent("Magkano kinita ko ngayon?")?.tool).toBe("report.today_summary");
  });

  it("routes list riders", () => {
    expect(parseFastRiverAiAgentIntent("list riders")?.tool).toBe("rider.list");
  });
});

describe("parseFastWriteRiverAiAgentIntent", () => {
  it("drafts add customer from plain text", () => {
    const intent = parseFastWriteRiverAiAgentIntent("add customer Juan Santos 09171234567");
    expect(intent?.tool).toBe("customer.create");
    expect(intent?.parameters.name).toBe("Juan Santos");
    expect(intent?.parameters.phone).toBe("09171234567");
  });

  it("drafts record payment", () => {
    const intent = parseFastWriteRiverAiAgentIntent("record payment 500 for OR-1234");
    expect(intent?.tool).toBe("transaction.record_payment");
    expect(intent?.parameters.amount).toBe(500);
    expect(intent?.parameters.referenceId).toBe("OR-1234");
  });
});
