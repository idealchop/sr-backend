import { db, FieldValue } from "../../config/firebase-admin";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { logger } from "../observability/logging/logger";
import { geminiGenerateJsonWithParts } from "../ai/gemini-multimodal";
import type { GeminiContentPart } from "../ai/gemini-multimodal";
import {
  buildSupportKnowledgeContext,
  SUPPORT_AI_PERSONA,
  type SupportKnowledgeEntry,
} from "../ai/support-knowledge-catalog";
import {
  buildAttachmentNote,
  buildFinalUserParts,
  buildSupportGeminiContents,
  extractLearnablePairs,
  SUPPORT_CONVERSATION_RULES,
  trimSessionSummary,
} from "./support-chat-ai";
import {
  countAttachmentKinds,
  fetchAttachmentForGemini,
  isSupportAttachmentMime,
  isSupportVideoMime,
  MAX_SUPPORT_ATTACHMENTS,
  MAX_VIDEOS_PER_MESSAGE,
  normalizeAttachmentMime,
} from "./support-attachment-media";
import {
  applySupportTurnHeuristics,
  DISSATISFIED_PATTERNS,
  HUMAN_ESCALATION_PATTERNS,
  SATISFIED_PATTERNS,
} from "./support-chat-turn-heuristics";
import type {
  SupportAiTurnResult,
  SupportChatMessage,
  SupportChatSession,
  SupportSessionStatus,
  SupportMessageAttachment,
} from "./support-chat-types";
import { SubscriptionService } from "../subscriptions/subscription-service";
import {
  resolveSupportAiPlanLimits,
  supportAiPlanLimitsFromSnapshot,
  type SupportAiUsageSnapshot,
} from "../../utils/support-ai-plan-limits";
import { SupportAiUsageService } from "./support-ai-usage-service";

const SESSIONS = "chat_sessions";
const MESSAGES = "messages";
const AI_KNOWLEDGE = "support_ai_knowledge";

// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
/** Coerce Gemini JSON into a stable SupportAiTurnResult. */
function normalizeSupportAiTurn(
  raw: unknown,
  fallback: SupportAiTurnResult,
): SupportAiTurnResult {
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;
  const reply = typeof o.reply === "string" ? o.reply.trim() : "";
  const topicOutOfScope = o.topicOutOfScope === true;
  return {
    reply: reply || fallback.reply,
    askSatisfaction: o.askSatisfaction === false ? false : true,
    suggestHuman: o.suggestHuman === true,
    suggestResolve: o.suggestResolve === true,
    detectedSatisfied: o.detectedSatisfied === true,
    detectedDissatisfied: o.detectedDissatisfied === true,
    detectedHumanRequest: o.detectedHumanRequest === true,
    topicOutOfScope,
    sessionSummary:
      typeof o.sessionSummary === "string" ?
        trimSessionSummary(o.sessionSummary) :
        undefined,
  };
}

function sessionsCol(businessId: string) {
  return db.collection("businesses").doc(businessId).collection(SESSIONS);
}

function knowledgeCol(businessId: string) {
  return db.collection("businesses").doc(businessId).collection(AI_KNOWLEDGE);
}

async function loadSupportAiUsage(
  businessId: string,
): Promise<SupportAiUsageSnapshot> {
  const sub = await SubscriptionService.getSubscriptionStatus(businessId);
  if (sub.supportAi) {
    return sub.supportAi as SupportAiUsageSnapshot;
  }
  const limits = resolveSupportAiPlanLimits({
    planCode: String(sub.planCode || "starter"),
    billingCycle: String(sub.billingCycle || ""),
    status: String(sub.status || ""),
    isExpired: !!sub.isExpired,
    agentChatEnabled: sub.supportAccess?.chatEnabled ?? false,
  });
  return SupportAiUsageService.getUsageSnapshot(businessId, limits);
}

function tsToIso(v: unknown): string {
  if (
    v &&
    typeof v === "object" &&
    typeof (v as { toDate?: () => Date }).toDate === "function"
  ) {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof v === "string") return v;
  return new Date().toISOString();
}

function serializeSession(
  id: string,
  businessId: string,
  data: FirebaseFirestore.DocumentData,
): SupportChatSession {
  return {
    id,
    businessId,
    userId: String(data.userId || ""),
    status: (data.status as SupportSessionStatus) || "ai_active",
    subject: data.subject,
    escalatedAt: data.escalatedAt ? tsToIso(data.escalatedAt) : undefined,
    resolvedAt: data.resolvedAt ? tsToIso(data.resolvedAt) : undefined,
    closureReason: data.closureReason,
    feedbackRating:
      typeof data.feedbackRating === "number" ? data.feedbackRating : undefined,
    feedbackComment: data.feedbackComment ?
      String(data.feedbackComment) :
      undefined,
    feedbackSubmittedAt: data.feedbackSubmittedAt ?
      tsToIso(data.feedbackSubmittedAt) :
      undefined,
    createdAt: tsToIso(data.createdAt),
    updatedAt: tsToIso(data.updatedAt),
    awaitingSatisfaction: !!data.awaitingSatisfaction,
    resolutionConfirmed: !!data.resolutionConfirmed,
    conversationSummary: data.conversationSummary ?
      String(data.conversationSummary) :
      undefined,
  };
}

function serializeMessage(
  id: string,
  data: FirebaseFirestore.DocumentData,
): SupportChatMessage {
  return {
    id,
    role: data.role as SupportChatMessage["role"],
    text: String(data.text || ""),
    createdAt: tsToIso(data.createdAt),
    meta: data.meta,
  };
}

const MAX_ATTACHMENTS = MAX_SUPPORT_ATTACHMENTS;

async function sanitizeAttachments(
  input?: SupportMessageAttachment[],
): Promise<SupportMessageAttachment[]> {
  if (!input?.length) return [];
  const filtered = input
    .slice(0, MAX_ATTACHMENTS)
    .filter((a) => typeof a.url === "string" && a.url.startsWith("https://"))
    .filter((a) =>
      isSupportAttachmentMime(normalizeAttachmentMime(a.mimeType, a.fileName)),
    );
  const videoCount = filtered.filter((a) =>
    isSupportVideoMime(normalizeAttachmentMime(a.mimeType, a.fileName)),
  ).length;
  if (videoCount > MAX_VIDEOS_PER_MESSAGE) {
    throw new Error("TOO_MANY_VIDEOS");
  }
  return filtered;
}

async function loadStoredKnowledge(
  businessId: string,
  limit = 20,
): Promise<SupportKnowledgeEntry[]> {
  const snap = await knowledgeCol(businessId)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      topic: String(data.question || "Learned answer").slice(0, 120),
      content: `Q: ${data.question}\nA: ${data.answer}`,
    };
  });
}

function ruleBasedReply(
  userText: string,
  history: SupportChatMessage[],
): SupportAiTurnResult {
  const lower = userText.toLowerCase();
  const priorAi = [...history].reverse().find((m) => m.role === "ai");
  const isFollowUp = history.filter((m) => m.role === "user").length > 1;

  let reply =
    "I'm **River AI**. I can help with your **water refilling / water station** questions " +
    "and the **Smart Refill** app. Ano ang kailangan mo?";

  if (isFollowUp && priorAi) {
    reply =
      "Salamat sa follow-up. Based on our chat so far—can you tell me which step failed or " +
      "what you see on screen now? I'll pick up from there.";
  }

  if (lower.includes("delivery") || lower.includes("deliver")) {
    reply =
      "To create a delivery: open **Transactions** → **Add Delivery**, choose the customer, " +
      "refill items, date, and payment method, then save. " +
      "Need step-by-step help on a specific screen?";
  } else if (lower.includes("collection") || lower.includes("pickup")) {
    reply =
      "For collections: go to **Transactions** → **Add Collection**, select the customer " +
      "and containers to pick up, then assign a rider if needed.";
  } else if (lower.includes("rider") || lower.includes("my area")) {
    reply =
      "Riders use **My Area** to view jobs on the map, update status, and complete deliveries " +
      "with proof and signature.";
  } else if (lower.includes("invite") || lower.includes("team")) {
    reply =
      "Owners can invite staff from **Team Hub** (Grow plan and above): " +
      "profile menu → Team Hub → Invite; teammate accepts the email link.";
  } else if (
    lower.includes("error") ||
    lower.includes("not working") ||
    lower.includes("still") ||
    lower.includes("failed") ||
    lower.includes("bug")
  ) {
    reply =
      "Got it. Let's troubleshoot this quickly:\n" +
      "1) Tell me the exact page + button you clicked.\n" +
      "2) Share the exact error text (or screenshot).\n" +
      "3) I'll give exact fix steps for that specific issue.\n\n" +
      "If you already tried refresh/logout-login, mention that so I skip repeated steps.";
  } else if (HUMAN_ESCALATION_PATTERNS.test(userText)) {
    reply =
      "I'll connect you with our human helpdesk team. Tap **Talk to human agent** below " +
      "to open live chat with Smart Refill support.";
    return {
      reply,
      askSatisfaction: false,
      suggestHuman: true,
      suggestResolve: false,
      detectedSatisfied: false,
      detectedDissatisfied: false,
      detectedHumanRequest: true,
      topicOutOfScope: false,
    };
  }

  return {
    reply,
    askSatisfaction: true,
    suggestHuman: false,
    suggestResolve: false,
    detectedSatisfied: SATISFIED_PATTERNS.test(userText),
    detectedDissatisfied: DISSATISFIED_PATTERNS.test(userText),
    detectedHumanRequest: false,
    topicOutOfScope: false,
  };
}

async function generateAiTurn(input: {
  businessId: string;
  userText: string;
  history: SupportChatMessage[];
  storedKnowledge: SupportKnowledgeEntry[];
  sessionSummary?: string;
  currentAttachments?: SupportMessageAttachment[];
}): Promise<SupportAiTurnResult> {
  const knowledge = buildSupportKnowledgeContext(
    input.storedKnowledge,
    input.userText,
  );
  const sessionMemory = trimSessionSummary(input.sessionSummary);
  const attachments = input.currentAttachments || [];
  const attachmentNote = buildAttachmentNote(attachments);

  const fallback = ruleBasedReply(input.userText, input.history);

  const jsonSchema = [
    "{",
    "  \"reply\": \"string — helpful answer in the user's language\",",
    "  \"sessionSummary\": \"string — brief memory for next turn: topic, names, " +
    "steps tried, what's still unresolved (max ~120 words)\",",
    "  \"askSatisfaction\": boolean — true after answering unless escalating,",
    "  \"suggestHuman\": boolean — true if user needs human or you cannot resolve,",
    "  \"suggestResolve\": boolean — true if conversation seems complete,",
    "  \"detectedSatisfied\": boolean — user expressed thanks/satisfaction,",
    "  \"detectedDissatisfied\": boolean — user said answer was not helpful,",
    "  \"detectedHumanRequest\": boolean — user asked for a person/agent,",
    "  \"topicOutOfScope\": boolean — true if unrelated to water refilling or Smart Refill",
    "}",
  ].join("\n");

  const memoryBlock = sessionMemory ?
    `\n\n## Active session memory (from earlier in this chat)\n${sessionMemory}` :
    "";

  const promptJson =
    `${SUPPORT_AI_PERSONA}\n\n${SUPPORT_CONVERSATION_RULES}\n\n${knowledge}${memoryBlock}\n\n` +
    "## Output style\n" +
    "- Be concise but concrete.\n" +
    "- For troubleshooting, provide numbered steps and one clear validation check.\n" +
    "- If uncertain, say what detail is missing and ask one focused question.\n\n" +
    `Respond ONLY with valid JSON matching this schema:\n${jsonSchema}`;

  const mediaParts: GeminiContentPart[] = [];
  for (const att of attachments) {
    const part = await fetchAttachmentForGemini(att);
    if (part) mediaParts.push(part);
  }

  const finalUserParts = buildFinalUserParts(
    input.userText,
    attachmentNote,
    mediaParts,
  );
  const contents = buildSupportGeminiContents({
    history: input.history,
    finalUserParts,
  });

  const rawTurn: unknown = await geminiGenerateJsonWithParts<SupportAiTurnResult>({
    system: promptJson,
    parts: finalUserParts,
    contents,
    fallback,
    temperature: 0.72,
  });

  const parsed = normalizeSupportAiTurn(rawTurn, fallback);
  const hasAttachments = (input.currentAttachments?.length || 0) > 0;

  return applySupportTurnHeuristics(parsed, input.userText, hasAttachments);
}

export class SupportChatService {
  // eslint-disable-next-line valid-jsdoc
  // eslint-disable-next-line valid-jsdoc
  /** Closes open sessions and starts a fresh River AI conversation. */
  static async startNewSession(
    businessId: string,
    userId: string,
  ): Promise<{
    session: SupportChatSession;
    messages: SupportChatMessage[];
    supportAiUsage: SupportAiUsageSnapshot;
  }> {
    const col = sessionsCol(businessId);
    const existing = await col.where("userId", "==", userId).limit(20).get();
    const batch = db.batch();
    let hasActive = false;

    for (const doc of existing.docs) {
      const status = doc.data().status as string;
      if (status === "ai_active" || status === "escalated") {
        hasActive = true;
        batch.update(doc.ref, {
          status: "resolved",
          resolvedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          resolutionConfirmed: true,
        });
      }
    }

    if (hasActive) await batch.commit();
    return this.getOrCreateActiveSession(businessId, userId);
  }

  static async getOrCreateActiveSession(
    businessId: string,
    userId: string,
  ): Promise<{
    session: SupportChatSession;
    messages: SupportChatMessage[];
    supportAiUsage: SupportAiUsageSnapshot;
  }> {
    const col = sessionsCol(businessId);
    const existing = await col.where("userId", "==", userId).limit(12).get();

    const activeDoc = existing.docs
      .filter((d) => {
        const s = d.data().status as string;
        return s === "ai_active" || s === "escalated";
      })
      .sort((a, b) => {
        const ta = a.data().updatedAt;
        const tb = b.data().updatedAt;
        const toMs = (v: unknown) =>
          v &&
          typeof v === "object" &&
          typeof (v as { toMillis?: () => number }).toMillis === "function" ?
            (v as { toMillis: () => number }).toMillis() :
            0;
        return toMs(tb) - toMs(ta);
      })[0];

    if (activeDoc) {
      const doc = activeDoc;
      const messages = await this.listMessages(businessId, doc.id);
      return {
        session: serializeSession(doc.id, businessId, doc.data()),
        messages,
        supportAiUsage: await loadSupportAiUsage(businessId),
      };
    }

    const ref = col.doc();
    const now = FieldValue.serverTimestamp();
    await ref.set({
      userId,
      status: "ai_active",
      type: "ai_assistant",
      subject: "Support",
      awaitingSatisfaction: false,
      resolutionConfirmed: false,
      createdAt: now,
      updatedAt: now,
    });

    const greeting =
      "Hi! I'm **River AI**. I can help with **water refilling & water station** topics " +
      "(operations, suki, deliveries, hygiene tips) and the full **Smart Refill** dashboard. " +
      "You can chat in **Filipino** or English—or send a **screenshot or screen recording**. " +
      "What do you need?\n\n" +
      "Para sa ibang topic na hindi tungkol sa tubig/refill o Smart Refill, sabihin ko nang " +
      "maayos na hanggang doon lang ang matutulong ko.";

    await ref.collection(MESSAGES).add({
      role: "ai",
      text: greeting,
      createdAt: FieldValue.serverTimestamp(),
      meta: {
        askSatisfaction: false,
        suggestHuman: false,
        suggestResolve: false,
      },
    });

    const sessionDoc = await ref.get();
    const messages = await this.listMessages(businessId, ref.id);
    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      session: serializeSession(ref.id, businessId, sessionDoc.data()!),
      messages,
      supportAiUsage: await loadSupportAiUsage(businessId),
    };
  }

  static async listMessages(
    businessId: string,
    sessionId: string,
  ): Promise<SupportChatMessage[]> {
    const snap = await sessionsCol(businessId)
      .doc(sessionId)
      .collection(MESSAGES)
      .orderBy("createdAt", "asc")
      .get();
    return snap.docs.map((d) => serializeMessage(d.id, d.data()));
  }

  static async sendUserMessage(
    businessId: string,
    sessionId: string,
    userId: string,
    text: string,
    attachments?: SupportMessageAttachment[],
  ): Promise<{
    session: SupportChatSession;
    messages: SupportChatMessage[];
    turn: SupportAiTurnResult;
    supportAiUsage: SupportAiUsageSnapshot;
  }> {
    const trimmed = text.trim();
    const sanitized = await sanitizeAttachments(attachments);

    const sessionRef = sessionsCol(businessId).doc(sessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) throw new Error("SESSION_NOT_FOUND");
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const sessionData = sessionSnap.data()!;
    if (sessionData.userId !== userId) throw new Error("FORBIDDEN");
    if (sessionData.status === "resolved") throw new Error("SESSION_RESOLVED");
    if (sessionData.status === "escalated") {
      throw new Error("SESSION_ESCALATED");
    }

    if (!trimmed && !sanitized.length) throw new Error("EMPTY_MESSAGE");

    const sub = await SubscriptionService.getSubscriptionStatus(businessId);
    const limits = sub.supportAi ?
      supportAiPlanLimitsFromSnapshot(sub.supportAi as SupportAiUsageSnapshot) :
      resolveSupportAiPlanLimits({
        planCode: String(sub.planCode || "starter"),
        billingCycle: String(sub.billingCycle || ""),
        status: String(sub.status || ""),
        isExpired: !!sub.isExpired,
        agentChatEnabled: sub.supportAccess?.chatEnabled ?? false,
      });
    await SupportAiUsageService.assertWithinLimits(
      businessId,
      limits,
      sanitized.length,
    );

    const { images, videos } = countAttachmentKinds(sanitized);
    const attachmentOnlyLabel =
      videos > 0 && images === 0 ?
        "Video attached — please review what happens on screen and suggest next steps." :
        videos > 0 ?
          "Photos and a screen recording are attached — review them and suggest next steps." :
          "Screenshot(s) attached — please help me interpret what’s on screen.";

    await sessionRef.collection(MESSAGES).add({
      role: "user",
      text: trimmed || attachmentOnlyLabel,
      createdAt: FieldValue.serverTimestamp(),
      meta: sanitized.length ? { attachments: sanitized } : undefined,
    });

    const history = await this.listMessages(businessId, sessionId);
    const storedKnowledge = await loadStoredKnowledge(businessId);
    const userTextForAi =
      trimmed ||
      (videos > 0 ?
        "The user sent a screen recording (and/or screenshots). Watch the video, describe " +
        "what you see related to Smart Refill or their water station, and suggest next steps." :
        "The user only sent screenshot(s). Describe what might be wrong based on Smart Refill " +
        "and suggest next steps.");

    const turn = await generateAiTurn({
      businessId,
      userText: userTextForAi,
      history,
      storedKnowledge,
      sessionSummary: sessionData.conversationSummary ?
        String(sessionData.conversationSummary) :
        undefined,
      currentAttachments: sanitized,
    });

    await sessionRef.collection(MESSAGES).add({
      role: "ai",
      text: turn.reply,
      createdAt: FieldValue.serverTimestamp(),
      meta: {
        askSatisfaction: turn.askSatisfaction,
        suggestHuman: turn.suggestHuman,
        suggestResolve: turn.suggestResolve,
      },
    });

    await sessionRef.update({
      updatedAt: FieldValue.serverTimestamp(),
      awaitingSatisfaction: turn.askSatisfaction,
      ...(turn.sessionSummary ?
        { conversationSummary: turn.sessionSummary } :
        {}),
    });

    await SupportAiUsageService.recordTurn(
      businessId,
      limits,
      sanitized.length,
    );

    const sessionDoc = await sessionRef.get();
    const messages = await this.listMessages(businessId, sessionId);
    const supportAiUsage = await SupportAiUsageService.getUsageSnapshot(
      businessId,
      limits,
    );
    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      session: serializeSession(sessionId, businessId, sessionDoc.data()!),
      messages,
      turn,
      supportAiUsage,
    };
  }

  static async recordSatisfaction(
    businessId: string,
    sessionId: string,
    userId: string,
    input: { satisfied: boolean; storeKnowledge?: boolean },
  ): Promise<{ session: SupportChatSession; storedKnowledgeId?: string }> {
    const sessionRef = sessionsCol(businessId).doc(sessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) throw new Error("SESSION_NOT_FOUND");
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const data = sessionSnap.data()!;
    if (data.userId !== userId) throw new Error("FORBIDDEN");

    const messages = await this.listMessages(businessId, sessionId);
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const lastAi = [...messages].reverse().find((m) => m.role === "ai");

    let storedKnowledgeId: string | undefined;
    if (input.satisfied && input.storeKnowledge && lastUser && lastAi) {
      const ref = await knowledgeCol(businessId).add({
        question: lastUser.text,
        answer: lastAi.text,
        sessionId,
        messageId: lastAi.id,
        createdBy: userId,
        createdAt: FieldValue.serverTimestamp(),
      });
      storedKnowledgeId = ref.id;
    }

    const systemText = input.satisfied ?
      "Glad that helped! When you're ready, you can mark this conversation as resolved." :
      "Thanks for the feedback. I can try again, or you can talk to a human agent for more help.";

    await sessionRef.collection(MESSAGES).add({
      role: "system",
      text: systemText,
      createdAt: FieldValue.serverTimestamp(),
    });

    await sessionRef.update({
      updatedAt: FieldValue.serverTimestamp(),
      awaitingSatisfaction: false,
    });

    const updated = await sessionRef.get();
    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      session: serializeSession(sessionId, businessId, updated.data()!),
      storedKnowledgeId,
    };
  }

  static async escalateToHuman(
    businessId: string,
    sessionId: string,
    userId: string,
  ): Promise<SupportChatSession> {
    const sub = await SubscriptionService.getSubscriptionStatus(businessId);
    if (!sub?.supportAccess?.chatEnabled) {
      throw new Error("LIVE_CHAT_NOT_AVAILABLE");
    }

    const sessionRef = sessionsCol(businessId).doc(sessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) throw new Error("SESSION_NOT_FOUND");
    if (sessionSnap.data()?.userId !== userId) throw new Error("FORBIDDEN");

    await sessionRef.collection(MESSAGES).add({
      role: "system",
      text: "Connecting you with a human support agent. Live chat will open below.",
      createdAt: FieldValue.serverTimestamp(),
    });

    await sessionRef.update({
      status: "escalated",
      escalatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      awaitingSatisfaction: false,
    });

    const updated = await sessionRef.get();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return serializeSession(sessionId, businessId, updated.data()!);
  }

  /**
   * Saves useful Q&A pairs from the thread for future River AI sessions.
   * @param {string} businessId Business id.
   * @param {string} sessionId Support session id.
   * @param {string} userId Firebase uid.
   * @param {SupportChatMessage[]} messages Full session messages.
   * @return {Promise<void>}
   */
  static async persistConversationLearnings(
    businessId: string,
    sessionId: string,
    userId: string,
    messages: SupportChatMessage[],
  ): Promise<void> {
    const pairs = extractLearnablePairs(messages);
    for (const pair of pairs) {
      await knowledgeCol(businessId).add({
        question: pair.question.slice(0, 500),
        answer: pair.answer.slice(0, 2000),
        sessionId,
        createdBy: userId,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  }

  static async resolveSession(
    businessId: string,
    sessionId: string,
    userId: string,
  ): Promise<SupportChatSession> {
    const sessionRef = sessionsCol(businessId).doc(sessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) throw new Error("SESSION_NOT_FOUND");
    if (sessionSnap.data()?.userId !== userId) throw new Error("FORBIDDEN");

    const messages = await this.listMessages(businessId, sessionId);
    await this.persistConversationLearnings(
      businessId,
      sessionId,
      userId,
      messages,
    );

    await sessionRef.collection(MESSAGES).add({
      role: "system",
      text:
        "This support conversation has been marked as resolved. " +
        "Open support anytime for a new session.",
      createdAt: FieldValue.serverTimestamp(),
    });

    await sessionRef.update({
      status: "resolved",
      resolvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      resolutionConfirmed: true,
      awaitingSatisfaction: false,
      closureReason: "user_resolved",
    });

    const updated = await sessionRef.get();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return serializeSession(sessionId, businessId, updated.data()!);
  }

  static async endPresenceSession(
    businessId: string,
    sessionId: string,
    userId: string,
    reason: "inactive_timeout" | "user_away",
  ): Promise<SupportChatSession> {
    const sessionRef = sessionsCol(businessId).doc(sessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) throw new Error("SESSION_NOT_FOUND");
    if (sessionSnap.data()?.userId !== userId) throw new Error("FORBIDDEN");

    const systemText =
      reason === "inactive_timeout" ?
        "River AI support ended automatically after no response to several check-ins. " +
        "Use **New conversation** anytime you're ready." :
        "Session closed. You're welcome back whenever you need help — " +
        "use **New conversation** to restart.";

    await sessionRef.collection(MESSAGES).add({
      role: "system",
      text: systemText,
      createdAt: FieldValue.serverTimestamp(),
      meta: { inactiveClose: true },
    });

    await sessionRef.update({
      status: "resolved",
      resolvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      resolutionConfirmed: true,
      awaitingSatisfaction: false,
      closureReason: reason,
    });

    const updated = await sessionRef.get();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return serializeSession(sessionId, businessId, updated.data()!);
  }

  static async acknowledgePresence(
    businessId: string,
    sessionId: string,
    userId: string,
  ): Promise<SupportChatMessage[]> {
    const sessionRef = sessionsCol(businessId).doc(sessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) throw new Error("SESSION_NOT_FOUND");
    if (sessionSnap.data()?.userId !== userId) throw new Error("FORBIDDEN");
    if (sessionSnap.data()?.status !== "ai_active") {
      throw new Error("SESSION_NOT_AI_ACTIVE");
    }

    await sessionRef.collection(MESSAGES).add({
      role: "system",
      text: "Thanks for confirming you're still here. What would you like to do next?",
      createdAt: FieldValue.serverTimestamp(),
      meta: { presencePrompt: true },
    });

    await sessionRef.update({ updatedAt: FieldValue.serverTimestamp() });
    return this.listMessages(businessId, sessionId);
  }

  static async submitFeedback(
    businessId: string,
    sessionId: string,
    userId: string,
    input: {
      rating?: number | null;
      comment?: string | null;
      skipped?: boolean;
    },
  ): Promise<SupportChatSession> {
    const sessionRef = sessionsCol(businessId).doc(sessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) throw new Error("SESSION_NOT_FOUND");
    if (sessionSnap.data()?.userId !== userId) throw new Error("FORBIDDEN");

    const update: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> =
      {
        updatedAt: FieldValue.serverTimestamp(),
        feedbackSubmittedAt: FieldValue.serverTimestamp(),
      };

    if (!input.skipped) {
      if (
        typeof input.rating === "number" &&
        input.rating >= 1 &&
        input.rating <= 5
      ) {
        update.feedbackRating = input.rating;
      }
      if (input.comment && typeof input.comment === "string") {
        const c = input.comment.trim();
        if (c.length) update.feedbackComment = c.slice(0, 2000);
      }
    }

    await sessionRef.update(update);
    const updated = await sessionRef.get();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return serializeSession(sessionId, businessId, updated.data()!);
  }

  static async getSession(
    businessId: string,
    sessionId: string,
    userId: string,
  ): Promise<{
    session: SupportChatSession;
    messages: SupportChatMessage[];
    supportAiUsage: SupportAiUsageSnapshot;
  }> {
    const sessionRef = sessionsCol(businessId).doc(sessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) throw new Error("SESSION_NOT_FOUND");
    if (sessionSnap.data()?.userId !== userId) throw new Error("FORBIDDEN");
    const messages = await this.listMessages(businessId, sessionId);
    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      session: serializeSession(sessionId, businessId, sessionSnap.data()!),
      messages,
      supportAiUsage: await loadSupportAiUsage(businessId),
    };
  }
}
