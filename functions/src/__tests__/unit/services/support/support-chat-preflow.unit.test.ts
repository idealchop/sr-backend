import { describe, expect, it } from "vitest";
import { SUPPORT_FAQ_ENTRIES } from "../../../../services/ai/support-knowledge-catalog";
import { tryResolveSupportPreflow } from "../../../../services/support/support-chat-preflow";
import type { SupportChatMessage } from "../../../../services/support/support-chat-types";

function msg(
  role: SupportChatMessage["role"],
  text: string,
): SupportChatMessage {
  return {
    id: `${role}-${text.slice(0, 8)}`,
    role,
    text,
    createdAt: new Date().toISOString(),
  };
}

describe("tryResolveSupportPreflow", () => {
  it("short-circuits greetings without Gemini", () => {
    const hit = tryResolveSupportPreflow({
      userText: "Hi!",
      history: [],
      knowledgeEntries: SUPPORT_FAQ_ENTRIES,
    });
    expect(hit?.source).toBe("greeting");
    expect(hit?.turn.resolutionSource).toBe("greeting");
    expect(hit?.turn.askSatisfaction).toBe(false);
    expect(hit?.turn.reply).toMatch(/River AI Buddy/i);
  });

  it("points human requests to Profile Chat support without escalate flags", () => {
    const hit = tryResolveSupportPreflow({
      userText: "Please talk to a human agent",
      history: [msg("user", "hi"), msg("ai", "hello")],
      knowledgeEntries: SUPPORT_FAQ_ENTRIES,
    });
    expect(hit?.source).toBe("human_request");
    expect(hit?.turn.suggestHuman).toBe(false);
    expect(hit?.turn.detectedHumanRequest).toBe(false);
    expect(hit?.turn.reply).toMatch(/Chat support/i);
  });

  it("resolves clear how-to delivery questions deterministically", () => {
    const hit = tryResolveSupportPreflow({
      userText: "Paano mag-add ng delivery?",
      history: [],
      knowledgeEntries: SUPPORT_FAQ_ENTRIES,
    });
    expect(hit?.source).toMatch(/deterministic_howto|knowledge_cache/);
    expect(hit?.turn.reply.toLowerCase()).toMatch(/delivery|transactions/);
  });

  it("returns knowledge_cache for high-confidence FAQ hits", () => {
    const hit = tryResolveSupportPreflow({
      userText: "How do I create a delivery?",
      history: [],
      knowledgeEntries: SUPPORT_FAQ_ENTRIES,
    });
    expect(hit).not.toBeNull();
    expect(["knowledge_cache", "deterministic_howto"]).toContain(hit?.source);
  });

  it("uses confirmed Q&A when question overlap is strong", () => {
    const hit = tryResolveSupportPreflow({
      userText: "How do I reset my printer settings in Smart Refill?",
      history: [],
      knowledgeEntries: [
        {
          id: "learned-1",
          topic: "How do I reset my printer settings in Smart Refill?",
          content:
            "Q: How do I reset my printer settings in Smart Refill?\n" +
            "A: Open Account → Devices, then tap Reset printer defaults.",
        },
      ],
    });
    expect(hit?.source).toBe("knowledge_cache");
    expect(hit?.knowledgeHit?.source).toBe("confirmed");
    expect(hit?.turn.reply).toMatch(/Reset printer/i);
  });

  it("does not short-circuit live sales questions", () => {
    const hit = tryResolveSupportPreflow({
      userText: "Magkano kinita ko ngayon?",
      history: [],
      knowledgeEntries: SUPPORT_FAQ_ENTRIES,
    });
    expect(hit).toBeNull();
  });

  it("does not short-circuit attachment turns", () => {
    const hit = tryResolveSupportPreflow({
      userText: "Paano mag-add ng delivery?",
      history: [],
      knowledgeEntries: SUPPORT_FAQ_ENTRIES,
      hasAttachments: true,
    });
    expect(hit).toBeNull();
  });

  it("does not short-circuit error / bug questions", () => {
    const hit = tryResolveSupportPreflow({
      userText: "May error sa app hindi gumagana ang delivery",
      history: [],
      knowledgeEntries: SUPPORT_FAQ_ENTRIES,
    });
    expect(hit).toBeNull();
  });

  it("sets resolutionSource on deterministic howto turns", () => {
    const hit = tryResolveSupportPreflow({
      userText: "How can I add a delivery order?",
      history: [],
      knowledgeEntries: [],
    });
    expect(hit?.source).toBe("deterministic_howto");
    expect(hit?.turn.resolutionSource).toBe("deterministic_howto");
    expect(hit?.turn.structured?.steps?.length).toBeGreaterThan(0);
  });

  it("short-circuits short thanks without Gemini", () => {
    const hit = tryResolveSupportPreflow({
      userText: "Salamat!",
      history: [msg("ai", "here is the answer")],
      knowledgeEntries: SUPPORT_FAQ_ENTRIES,
    });
    expect(hit?.source).toBe("greeting");
    expect(hit?.turn.detectedSatisfied).toBe(true);
    expect(hit?.turn.reply).toMatch(/Salamat/i);
  });

  it("resolves intent-only howto without paano opener", () => {
    const hit = tryResolveSupportPreflow({
      userText: "Add delivery for a suki",
      history: [],
      knowledgeEntries: [],
    });
    expect(hit?.source).toBe("deterministic_howto");
    expect(hit?.turn.reply.toLowerCase()).toMatch(/delivery|transactions/);
  });

  it("resolves subscription how-to from FAQ before Gemini", () => {
    const hit = tryResolveSupportPreflow({
      userText: "Paano magbayad ng plan with GCash?",
      history: [],
      knowledgeEntries: SUPPORT_FAQ_ENTRIES,
    });
    expect(hit).not.toBeNull();
    expect(["knowledge_cache", "deterministic_howto"]).toContain(hit?.source);
    expect(hit?.turn.reply.toLowerCase()).toMatch(/gcash|subscription|maya|account/);
  });
});
