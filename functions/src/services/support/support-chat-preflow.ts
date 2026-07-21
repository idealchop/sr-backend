/**
 * Thin pre-Gemini tiers for River AI Buddy.
 * Resolve cheap, high-confidence turns before calling the model —
 * greetings, thanks, FAQ/doc cache, and deterministic app how-tos.
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

/**
 * Troubleshooting / media — always Gemini (never FAQ/howto steal).
 */
const TROUBLESHOOT_PATTERNS = new RegExp(
  "\\b(" +
    "screenshot|screen recording|error|bug|failed|" +
    "not working|hindi gumagana|ayaw mag-?open|crash|broken" +
  ")\\b",
  "i",
);

/**
 * Live station metrics — Gemini + workspace when FAQ did not already resolve
 * (e.g. plan pricing FAQs may still hit knowledge_cache first).
 */
const LIVE_DATA_PATTERNS = new RegExp(
  "\\b(" +
    "kinita|kita|earnings|revenue|sales|benta|utang|balance|forecast|" +
    "magkano|how much|dormant|inactive suki|health|snapshot" +
  ")\\b",
  "i",
);

const GREETING_PATTERNS = new RegExp(
  "^(hi|hello|hey|yo|good\\s*(morning|afternoon|evening)|" +
    "kamusta|kumusta|musta|hola|helo|heyy+)[!.?\\s]*$",
  "i",
);

/** Short thank-you / ack — no need to burn a Gemini turn. */
const THANKS_ONLY_PATTERNS = new RegExp(
  "^(salamat(\\s+po)?|thanks(\\s+a\\s+lot)?|thank\\s+you(\\s+so\\s+much)?|" +
    "ok(ay)?(\\s+salamat)?|got\\s+it|all\\s+good|clear|perfect|sige(\\s+salamat)?)[!.?\\s]*$",
  "i",
);

const HOW_TO_OPENERS =
  /^(paano|pano|how\s+(do|to|can)|saan|where|ano\s+ang\s+gagawin|help\s+(me\s+)?(with|sa))\b/i;

type HowtoRule = {
  id: string;
  match: RegExp;
  /** When true, match even without paano/how opener (phrase is specific enough). */
  intentOnly?: boolean;
  structured: SupportStructuredReply;
};

const HOWTO_RULES: HowtoRule[] = [
  {
    id: "delivery",
    match: /\b(delivery|deliver|add\s+delivery|record\s+order|mag-?deliver)\b/i,
    intentOnly: true,
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
          title: "Buksan ang Transactions → Add Delivery (o Record order)",
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
    intentOnly: true,
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
    id: "customers",
    match: /\b(add\s+customer|mag-?add\s+ng\s+suki|customer\s+profile|import\s+customer)\b/i,
    intentOnly: true,
    structured: {
      sectionLabel: "SAGOT",
      summary:
        "Bagong suki: pumunta sa **Customers** → **Add Customer**. Bulk import available kung may listahan ka.",
      badges: [
        { label: "Customers", tone: "info" },
        { label: "From guide", tone: "success" },
      ],
      steps: [
        {
          title: "Customers → Add Customer",
          body: "Ilagay ang name, phone, at delivery address.",
          priority: "high",
          tags: ["Customers"],
        },
        {
          title: "Optional: Import",
          body: "Gamitin ang import kung maraming suki nang isang bagsak.",
          priority: "medium",
          tags: ["Customers"],
        },
      ],
    },
  },
  {
    id: "team",
    match: /\b(invite|team\s*hub|staff|rider\s+invite)\b/i,
    intentOnly: true,
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
    intentOnly: true,
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
    id: "portal",
    match: /\b(qr\s*portal|customer\s+portal|portal\s+order|suki\s+portal)\b/i,
    intentOnly: true,
    structured: {
      sectionLabel: "SAGOT",
      summary:
        "Orders mula sa **QR / customer portal** ay pumapasok muna bilang **Submissions** — " +
        "i-approve mo bago maging opisyal na transaction.",
      badges: [
        { label: "Portal", tone: "info" },
        { label: "From guide", tone: "success" },
      ],
      steps: [
        {
          title: "Buksan ang Submissions",
          body: "Review at match/approve ang portal order.",
          priority: "high",
          tags: ["Submissions"],
        },
        {
          title: "Pagkatapos ng accept",
          body: "Lalabas ang order sa Transactions / Operations para i-assign o i-deliver.",
          priority: "medium",
          tags: ["Transactions"],
        },
      ],
    },
  },
  {
    id: "inventory",
    match: /\b(inventory|stocks?|mag-?add\s+ng\s+(container|cap|stock))\b/i,
    intentOnly: false,
    structured: {
      sectionLabel: "SAGOT",
      summary:
        "I-setup ang containers, caps, at supplies sa **Inventory** page para ma-track ang stock " +
        "kasama ang deliveries at walk-in sales.",
      badges: [
        { label: "Inventory", tone: "info" },
        { label: "From guide", tone: "success" },
      ],
      steps: [
        {
          title: "Buksan ang Inventory",
          priority: "high",
          tags: ["Inventory"],
        },
        {
          title: "I-add o i-restock ang items",
          body: "Round/Slim, rotation shells, caps, at supplies ayon sa setup ng station mo.",
          priority: "high",
          tags: ["Inventory"],
        },
      ],
    },
  },
  {
    id: "subscription",
    match:
      /\b(subscription|magbayad\s+ng\s+plan|renew|upgrade\s+plan|gcash|maya|auto-?renew)\b/i,
    intentOnly: true,
    structured: {
      sectionLabel: "SAGOT",
      summary:
        "Plan at billing: **Account → Subscription** (o Pricing). Pwede magbayad online via " +
        "**GCash / Maya**; iwanan naka-check ang **Allow auto-renew** kung gusto mong i-link ang wallet.",
      badges: [
        { label: "Subscription", tone: "info" },
        { label: "From guide", tone: "success" },
      ],
      steps: [
        {
          title: "Account → Subscription (o Pricing → checkout)",
          priority: "high",
          tags: ["Account"],
        },
        {
          title: "Pay with GCash or Maya",
          body: "O i-expand ang Pay manually instead para sa bank transfer + proof.",
          priority: "high",
          tags: ["Account"],
        },
      ],
    },
  },
  {
    id: "offline",
    match: /\b(offline|brownout|walang\s+signal|sync\s+queue)\b/i,
    intentOnly: true,
    structured: {
      sectionLabel: "SAGOT",
      summary:
        "Partial **offline** supported: mag-sign in online muna isang beses. Pag walang signal, " +
        "makikita ang cached suki/jobs; walk-in, delivery, at cash ay pumapasok sa **Sync queue**.",
      badges: [
        { label: "Offline", tone: "info" },
        { label: "From guide", tone: "success" },
      ],
      highlights: [
        {
          title: "Hindi pa offline",
          body: "Sign-in, River AI, live maps, at portal orders ay kailangan pa ng internet.",
          variant: "note",
        },
      ],
    },
  },
  {
    id: "rider",
    match: /\b(my\s+area|rider\s+app|ano\s+gagawin\s+ng\s+rider)\b/i,
    intentOnly: true,
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
  {
    id: "live-helpdesk",
    match: /\b(chat\s+support|live\s+helpdesk|brevo)\b/i,
    intentOnly: true,
    structured: {
      sectionLabel: "SAGOT",
      summary:
        "Live helpdesk ay nasa **Profile → Chat support** — hiwalay sa River AI Buddy. " +
        "Dito sa Buddy tuloy ang app how-to at station questions.",
      badges: [
        { label: "Separate helpdesk", tone: "info" },
        { label: "From guide", tone: "success" },
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

const THANKS_STRUCTURED: SupportStructuredReply = {
  sectionLabel: "SAGOT",
  summary:
    "Salamat! Kung may iba ka pang tanong tungkol sa app o station mo, sabihin mo lang.",
  badges: [{ label: "Here anytime", tone: "success" }],
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

function tryHowtoRule(userText: string): SupportPreflowResult | null {
  const hasOpener = HOW_TO_OPENERS.test(userText);
  for (const rule of HOWTO_RULES) {
    if (!rule.match.test(userText)) continue;
    if (!hasOpener && !rule.intentOnly) continue;
    return {
      source: "deterministic_howto",
      turn: finishPreflowTurn(rule.structured, "deterministic_howto", {
        sessionSummary: `Resolved via deterministic howto: ${rule.id}`,
        ...satisfactionFlags(userText),
      }),
    };
  }
  return null;
}

/**
 * Attempt a deterministic / cache resolution before Gemini.
 * Returns null when the turn should use the model path.
 *
 * Order (cheapest first):
 * 1. Human helpdesk pointer
 * 2. Greeting
 * 3. Short thanks / ack
 * 4. Bail out for troubleshooting / screenshots (Gemini)
 * 5. High-confidence FAQ / learned Q&A / docs
 * 6. Bail out for live-data keywords (Gemini + workspace)
 * 7. Deterministic app how-tos
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

  if (THANKS_ONLY_PATTERNS.test(userText)) {
    return {
      source: "greeting",
      turn: finishPreflowTurn(THANKS_STRUCTURED, "greeting", {
        askSatisfaction: false,
        suggestResolve: true,
        detectedSatisfied: true,
        sessionSummary: "User thanked Buddy; offered to help with more questions.",
      }),
    };
  }

  // Errors / crashes / screenshots always need the model path.
  if (TROUBLESHOOT_PATTERNS.test(userText)) return null;

  // App FAQ / docs / learned Q&A — before live-data bail-out so "magkano ang plan"
  // can still resolve from subscription knowledge without Gemini.
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

  // Live metrics stay on the model + workspace path when FAQ missed.
  if (LIVE_DATA_PATTERNS.test(userText)) return null;

  const howto = tryHowtoRule(userText);
  if (howto) return howto;

  return null;
}
