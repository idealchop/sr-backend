/**
 * Thin pre-Gemini tiers for River AI Buddy.
 * Resolve cheap, high-confidence turns before calling the model.
 */

import {
  findHighConfidenceKnowledgeHit,
  type SupportKnowledgeEntry,
  type SupportKnowledgeHit,
} from "../ai/support-knowledge-catalog";
import {
  DISSATISFIED_PATTERNS,
  HUMAN_SUPPORT_POINTER_PATTERNS,
  SATISFIED_PATTERNS,
} from "./support-chat-turn-heuristics";
import type {
  SupportAiTurnResult,
  SupportChatMessage,
  SupportResolutionSource,
  SupportStructuredReply,
} from "./support-chat-types";
import { structuredReplyToPlainText } from "./support-structured-reply";

export type SupportPreflowSource = Exclude<
  SupportResolutionSource,
  "workspace" | "gemini"
>;

export type SupportPreflowResult = {
  source: SupportPreflowSource;
  turn: SupportAiTurnResult;
  knowledgeHit?: SupportKnowledgeHit;
};

/** Live station / troubleshooting questions must keep the Gemini + workspace path. */
const NEEDS_MODEL_PATTERNS = new RegExp(
  "\\b(" +
    "kinita|kita|earnings|revenue|sales|benta|utang|balance|forecast|" +
    "magkano|how much|screenshot|screen recording|error|bug|failed|" +
    "not working|hindi gumagana|ayaw mag-?open|crash|broken|" +
    "dormant|inactive suki|health|snapshot" +
  ")\\b",
  "i",
);

const GREETING_PATTERNS = new RegExp(
  "^(hi|hello|hey|yo|good\\s*(morning|afternoon|evening)|" +
    "kamusta|kumusta|musta|hola|helo|heyy+)[!.?\\s]*$",
  "i",
);

const HOW_TO_OPENERS =
  /^(paano|pano|how\s+(do|to|can)|saan|where|ano\s+ang\s+gagawin|help\s+(me\s+)?(with|sa))\b/i;

const HOWTO_RULES: Array<{
  id: string;
  match: RegExp;
  structured: SupportStructuredReply;
}> = [
  {
    id: "delivery",
    match: /\b(delivery|deliver|add\s+delivery)\b/i,
    structured: {
      sectionLabel: "SAGOT",
      summary:
        "Para mag-create ng delivery, gamitin ang **Transactions** flow sa dashboard.",
      badges: [
        { label: "Quick tip", tone: "info" },
        { label: "From guide", tone: "success" },
      ],
      steps: [
        {
          title: "Buksan ang Transactions → Add Delivery",
          body: "Piliin ang customer, refill items, date, at payment method.",
          priority: "high",
          tags: ["Transactions"],
        },
        {
          title: "I-save at i-assign ang rider kung kailangan",
          priority: "medium",
          tags: ["Operations"],
        },
      ],
    },
  },
  {
    id: "collection",
    match: /\b(collection|pickup|add\s+collection|koleksyon)\b/i,
    structured: {
      sectionLabel: "SAGOT",
      summary: "Para sa collections, gamitin ang **Add Collection** sa Transactions page.",
      badges: [
        { label: "Quick tip", tone: "info" },
        { label: "From guide", tone: "success" },
      ],
      steps: [
        {
          title: "Transactions → Add Collection",
          body: "Piliin ang customer at containers na kukunin.",
          priority: "high",
          tags: ["Transactions"],
        },
        {
          title: "I-assign ang rider kung kailangan",
          priority: "medium",
          tags: ["My Area"],
        },
      ],
    },
  },
  {
    id: "team",
    match: /\b(invite|team\s*hub|staff|rider\s+invite)\b/i,
    structured: {
      sectionLabel: "SAGOT",
      summary:
        "Pwede mag-invite ng staff ang owners mula sa **Team Hub** (Grow plan pataas).",
      badges: [
        { label: "Team Hub", tone: "info" },
        { label: "From guide", tone: "success" },
      ],
      steps: [
        {
          title: "Profile menu → Team Hub → Invite",
          priority: "high",
          tags: ["Team Hub"],
        },
        {
          title: "Hintayin ang teammate na tanggapin ang email link",
          priority: "medium",
        },
      ],
    },
  },
  {
    id: "tutorials",
    match: /\b(tutorial|video\s+tutorial|how-?to\s+video|manood)\b/i,
    structured: {
      sectionLabel: "SAGOT",
      summary:
        "Open **Tutorial videos** mula sa left sidebar (desktop) o floating Tutorial button " +
        "(mobile), tap Play, at follow along habang nagtatrabaho ka sa app.",
      badges: [
        { label: "Tutorials", tone: "info" },
        { label: "From guide", tone: "success" },
      ],
      steps: [
        {
          title: "Buksan Tutorial videos",
          body: "Sidebar (desktop) o floating Tutorial button (mobile).",
          priority: "high",
          tags: ["Tutorials"],
        },
        {
          title: "Pumili ng lesson at i-Play",
          body: "Mananatili ang maliit na coach player habang nagna-navigate ka.",
          priority: "medium",
          tags: ["Tutorials"],
        },
      ],
    },
  },
  {
    id: "rider",
    match: /\b(my\s+area|rider\s+app|ano\s+gagawin\s+ng\s+rider)\b/i,
    structured: {
      sectionLabel: "SAGOT",
      summary:
        "Ang riders ay gumagamit ng **My Area** para makita ang jobs, i-update ang status, " +
        "at i-complete ang deliveries with proof at signature.",
      badges: [
        { label: "My Area", tone: "success" },
        { label: "From guide", tone: "info" },
      ],
      highlights: [
        {
          title: "Live map at route",
          body: "Makikita ang assigned jobs, driving route, at ETAs sa My Area.",
          variant: "action",
        },
      ],
    },
  },
];

const GREETING_STRUCTURED: SupportStructuredReply = {
  sectionLabel: "SAGOT",
  summary:
    "Hi! Ako si **River AI Buddy** — kasama mo sa araw-araw na negosyo ng water station mo. " +
    "Puwede kitang tulungan sa **kita ngayon**, utang, dormant suki, forecast, tips, at sa **Smart Refill** app. " +
    "Ano ang gusto mong tingnan?",
  badges: [
    { label: "Your WRS buddy", tone: "info" },
    { label: "Live data", tone: "success" },
  ],
  highlights: [
    {
      title: "Try asking",
      body:
        "\"Magkano kinita ko ngayon?\" · \"Magkano sales kahapon?\" · \"Kumusta ang station ko?\"",
      variant: "tip",
    },
    {
      title: "Screenshots & videos",
      body: "I-upload kung may error sa screen — titingnan ko at bibigyan ka ng fix steps.",
      variant: "note",
    },
  ],
};

function finishPreflowTurn(
  structured: SupportStructuredReply,
  source: SupportPreflowSource,
  overrides: Partial<SupportAiTurnResult> = {},
): SupportAiTurnResult {
  return {
    reply: structuredReplyToPlainText(structured),
    structured,
    askSatisfaction: true,
    suggestHuman: false,
    suggestResolve: false,
    detectedSatisfied: false,
    detectedDissatisfied: false,
    detectedHumanRequest: false,
    topicOutOfScope: false,
    resolutionSource: source,
    ...overrides,
  };
}

function satisfactionFlags(userText: string): Partial<SupportAiTurnResult> {
  return {
    detectedSatisfied:
      SATISFIED_PATTERNS.test(userText) && !DISSATISFIED_PATTERNS.test(userText),
    detectedDissatisfied: DISSATISFIED_PATTERNS.test(userText),
  };
}

function answerFromKnowledge(hit: SupportKnowledgeHit): SupportAiTurnResult {
  const entry = hit.entry;
  const answerBody = entry.content
    .replace(/^Q:\s*.+\nA:\s*/i, "")
    .trim();
  const structured: SupportStructuredReply = {
    sectionLabel: "SAGOT",
    summary: answerBody.slice(0, 420),
    badges: [
      { label: "Known answer", tone: "success" },
      { label: hit.source === "confirmed" ? "Learned Q&A" : "FAQ", tone: "info" },
    ],
    highlights: [
      {
        title: entry.topic,
        body: "Sagot mula sa saved / FAQ knowledge — i-confirm kung tama pa rin ito.",
        variant: "tip",
      },
    ],
    evidence: answerBody.length > 420 ? answerBody : undefined,
  };
  return finishPreflowTurn(structured, "knowledge_cache", {
    sessionSummary: `Resolved via knowledge cache (${hit.source}): ${entry.topic}`,
  });
}

/**
 * Attempt a deterministic / cache resolution before Gemini.
 * Returns null when the turn should use the model path.
 */
export function tryResolveSupportPreflow(input: {
  userText: string;
  history: SupportChatMessage[];
  knowledgeEntries: SupportKnowledgeEntry[];
  hasAttachments?: boolean;
}): SupportPreflowResult | null {
  const userText = (input.userText || "").trim();
  if (!userText) return null;
  if (input.hasAttachments) return null;

  if (HUMAN_SUPPORT_POINTER_PATTERNS.test(userText)) {
    return {
      source: "human_request",
      turn: finishPreflowTurn(
        {
          sectionLabel: "SAGOT",
          summary:
            "Para sa **live helpdesk** (billing, account, o escalated issues), buksan ang " +
            "**Profile menu → Chat support** — hiwalay iyon sa River AI Buddy. " +
            "Dito tuloy tayo sa app, station data, at how-to. Ano ang itutuloy natin?",
          badges: [
            { label: "Separate helpdesk", tone: "info" },
            { label: "Buddy stays here", tone: "success" },
          ],
          highlights: [
            {
              title: "Chat support",
              body: "Profile → Chat support opens the live helpdesk. River AI Buddy does not hand off into that chat.",
              variant: "note",
            },
          ],
        },
        "human_request",
        {
          askSatisfaction: false,
          suggestHuman: false,
          detectedHumanRequest: false,
          sessionSummary:
            "User asked for a human; pointed to Profile → Chat support (separate from Buddy).",
        },
      ),
    };
  }

  if (GREETING_PATTERNS.test(userText)) {
    return {
      source: "greeting",
      turn: finishPreflowTurn(GREETING_STRUCTURED, "greeting", {
        askSatisfaction: false,
        sessionSummary: "User greeted Buddy; awaiting their first question.",
        ...satisfactionFlags(userText),
      }),
    };
  }

  // Live data / bugs stay on the model + workspace path.
  if (NEEDS_MODEL_PATTERNS.test(userText)) return null;

  const knowledgeHit = findHighConfidenceKnowledgeHit(
    input.knowledgeEntries,
    userText,
  );
  if (knowledgeHit) {
    return {
      source: "knowledge_cache",
      knowledgeHit,
      turn: {
        ...answerFromKnowledge(knowledgeHit),
        ...satisfactionFlags(userText),
      },
    };
  }

  if (HOW_TO_OPENERS.test(userText)) {
    for (const rule of HOWTO_RULES) {
      if (!rule.match.test(userText)) continue;
      return {
        source: "deterministic_howto",
        turn: finishPreflowTurn(rule.structured, "deterministic_howto", {
          sessionSummary: `Resolved via deterministic howto: ${rule.id}`,
          ...satisfactionFlags(userText),
        }),
      };
    }
  }

  return null;
}
