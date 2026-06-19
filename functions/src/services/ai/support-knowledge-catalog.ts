/**
 * Curated FAQ + in-app process knowledge for River AI support (dashboard context).
 * Product documentation summaries: ./product-documentation-knowledge.ts
 * (sync with smartrefill-v3/docs/).
 */

import {
  SUPPORT_PRODUCT_DOCUMENTATION,
  SUPPORT_PRODUCT_DOC_ENTRIES,
} from "./product-documentation-knowledge";

export type SupportKnowledgeEntry = {
  id: string;
  topic: string;
  content: string;
};

const SUPPORT_CONTEXT_ENTRY_LIMIT = 14;

export const SUPPORT_AI_PERSONA = [
  "You are **River AI Buddy** — the owner's day-to-day companion for their water refilling station (WRS)",
  "in the Philippines and the Smart Refill app.",
  "",
  "You are NOT just a helpdesk. You help owners:",
  "- Understand **live business numbers** and **schedule** from the Firestore snapshot injected each turn.",
  "  Collections read: transactions, customers, inventory_items, riders, raw_submissions, members.",
  "- Get **light forecasts** from recent averages (say clearly when it is an estimate, not a guarantee).",
  "- Receive **practical tips** for collections, retention, dispatch, and hygiene.",
  "- Learn **how to use Smart Refill** (customers, transactions, riders, inventory, portal).",
  "",
  "## Scope (help with these freely)",
  "- **WRS business & operations**: revenue, expenses, suki, deliveries, collections, riders, inventory,",
  "  pricing ideas (general), hygiene habits, and day-to-day decisions.",
  "- **Smart Refill app & dashboard**: all owner workflows and troubleshooting.",
  "",
  "Treat each chat as an ongoing conversation with someone you know — warm, encouraging, practical.",
  "",
  "## Out of scope (must refuse clearly)",
  "If the user asks about unrelated topics (programming, politics, homework, medical diagnosis,",
  "legal advice, or anything not about water refilling, water stations, or Smart Refill):",
  "- Set **topicOutOfScope** to true.",
  "- In **reply**, politely explain—in **Taglish**—that you focus on their **WRS business** and **Smart Refill**.",
  "- Set **suggestHuman** to false unless they need Smart Refill account or billing help.",
  "- Keep the tone warm and short.",
  "",
  "## Language",
  "- **Default:** Reply in **Taglish** — natural Filipino–English mix, warm and conversational",
  "  (how many water-station owners talk day-to-day). Use Taglish even when the user writes in",
  "  pure English, unless they clearly prefer another style.",
  "- If the user writes mainly in **Filipino/Tagalog**, **Cebuano/Bisaya**, **Ilocano**, or another",
  "  Philippine language, match their language or mix.",
  "- Mirror their wording when they strongly prefer a dialect; otherwise stay in Taglish.",
  "",
  "## Business data (required)",
  "- **Answer first, guide second.** Lead **summary** with the direct personal answer using snapshot numbers.",
  "- Use **ikaw/ka** tone: \"Kumita **ka** ng ₱X kahapon\", \"May ₱Y kang utang\", etc.",
  "- Period mapping: Today → Today (PHP); Yesterday → Yesterday (PHP); 7 days → Last 7 days (PHP).",
  "- Put app navigation in **steps[]** after the answer (e.g. Transactions → filter Yesterday).",
  "- **Never** give only app steps without stating the amount from live data.",
  "- Add 1 practical tip tied to their numbers.",
  "- For forecasts, use **Simple next-7-day forecast** and label it as a rough projection.",
  "",
  "## Images & attachments",
  "When the user sends images (screenshots, photos of equipment, receipts, errors, forms):",
  "- **Describe what you see** and tie it to Smart Refill or water-station context.",
  "- If the image is unreadable, say so and ask for a clearer photo or type the error text.",
  "",
  "## Video attachments",
  "When the user sends a screen recording or short video (MP4, WebM, MOV):",
  "- **Watch the full clip** and describe key moments: taps, errors, loading states, wrong data.",
  "- Summarize the user's workflow issue and give concrete fix steps.",
  "- Prefer clips under ~60 seconds; if too long or unclear, ask for a shorter focused recording.",
  "- **Do not** set **suggestHuman** or **detectedHumanRequest** just because of media—",
  "  keep helping in River AI unless they explicitly ask for a live agent.",
  "- If unrelated to water refilling or the app, set **topicOutOfScope** true and explain briefly.",
  "",
  "## Safety & honesty",
  "- Never invent Smart Refill features, prices, customer names, or revenue figures not in the snapshot.",
  "- For permits/health codes, give general guidance and suggest confirming with local LGU/health.",
  "- If you cannot help within scope, offer **Talk to human agent** (set **suggestHuman** true).",
].join("\n");

export const SUPPORT_WATER_STATION_CONTEXT = `
## Water refilling / station context (general, Philippines)

- Owners usually sell refilled drinking water in various container sizes; track orders, deliveries,
  and container returns.
- **Hygiene**: emphasize clean filling area, sanitized containers, staff hand hygiene, and
  protecting stored water—without claiming specific lab results.
- **Operations**: peak hours, subscription-style regular customers, coordination with riders for
  delivery/collection, simple record-keeping.
- **Customer issues**: late delivery, wrong container count, reschedule—tie to dashboard actions
  when relevant.
`;

export const SUPPORT_APP_WORKFLOWS = `
${SUPPORT_WATER_STATION_CONTEXT}

## Smart Refill dashboard — how things work

### Getting started
- Sign in with your business account. Complete staff onboarding if you were invited as team staff.
- Owners manage subscription, billing, team invites, and full settings under Account.

### Customers
- Customers page: add customers, import bulk, view profiles, balances, and delivery history.
- Customer QR portal lets customers place orders, track deliveries, and request collections.

### Transactions (deliveries & collections)
- Add Delivery: schedule refill delivery to a customer, assign rider, set payment method.
- Add Collection: schedule container pickup with expected quantities.
- Transaction list: filter by status (pending, in transit, delivered, collected, completed).
- Update status as riders progress; collection dialog records good/damaged/missing quantities.

### Operations
- Operations hub: fleet, quotas, cash reconciliation, assign/reassign riders, performance metrics.
- Team Hub (Grow+): invite admins or riders; riders land on My Area only.

### My Area (riders)
- Riders see assigned jobs on map/list, GPS tracking, mark delivered/collected, complete with proof
  and signature.

### Inventory
- Track containers, caps, and station stock; link items to transactions.

### Submissions / portal
- Review customer portal requests (orders, collections, profile updates) before they apply to
  records.

### Subscriptions & support
- Plans: Starter, Grow, Scale, Enterprise — features vary (team hub, live human chat, AI credits for
  other in-app AI tools).
- Support: River AI chat is included for help with the app and water station topics; human live chat
  (Brevo) when you need a person.
`;

/** Static FAQ entries (station-owner focused). */
export const SUPPORT_FAQ_ENTRIES: SupportKnowledgeEntry[] = [
  {
    id: "what-is-smart-refill",
    topic: "What is Smart Refill?",
    content:
      "Smart Refill is a platform for water refilling station owners to manage customers, " +
      "deliveries, collections, inventory, riders, and billing in one dashboard.",
  },
  {
    id: "add-delivery",
    topic: "How do I create a delivery?",
    content:
      "Go to Transactions → Add Delivery. Pick a customer, water types/quantities, " +
      "delivery date, payment method, and optional rider. Save to create a pending delivery job.",
  },
  {
    id: "add-collection",
    topic: "How do I schedule a collection?",
    content:
      "Go to Transactions → Add Collection. Select customer and containers to collect " +
      "with expected quantities. Assign a rider if needed.",
  },
  {
    id: "rider-my-area",
    topic: "What can riders do?",
    content:
      "Riders use My Area to see assigned jobs on a map, navigate, mark delivered/collected, " +
      "capture proof of delivery, signature, and notes, then complete the job.",
  },
  {
    id: "team-invite",
    topic: "How do I invite staff?",
    content:
      "Owners open Team Hub from the profile menu (Grow+ plans). Send an invite by email; " +
      "the invitee accepts the link and completes staff onboarding.",
  },
  {
    id: "portal-orders",
    topic: "Customer portal orders",
    content:
      "Customers can order via QR portal. Orders appear as submissions for you to approve " +
      "before they become transactions.",
  },
  {
    id: "subscription-plans",
    topic: "Subscription plans",
    content:
      "Starter has core features with limits. Grow adds team hub and live human support. " +
      "Scale/Enterprise add higher limits and advanced operations. " +
      "Check Account → Subscription for your plan.",
  },
  {
    id: "data-privacy",
    topic: "Data privacy",
    content:
      "Customer data is stored securely for order and delivery operations. Only your workspace " +
      "members with access can view business data.",
  },
  {
    id: "offline",
    topic: "Offline use",
    content:
      "Some views cache data for reliability; sync when back online. " +
      "Critical actions need connectivity.",
  },
  {
    id: "human-support",
    topic: "Talk to a human",
    content:
      "If River AI cannot resolve your issue, tap Talk to human agent in support chat " +
      "to connect with the Smart Refill helpdesk via live chat.",
  },
  {
    id: "station-hygiene-basics",
    topic: "Basic hygiene sa refilling station",
    content:
      "Kalimitan: malinis na dispensing area at gallon handling; mahalaga ang tamang imbakan. " +
      "Kung LGU/DOH inspections o permits, kumpirmahin sa local health office—iba-iba ang " +
      "requirements ayon sa lugar.",
  },
  {
    id: "customer-scheduling-tips",
    topic: "Tips sa delivery at suki schedules",
    content:
      "Maraming stations ang may regular na araw/araw-deliver kay suki. " +
      "Gamitin ang **Add Delivery** at **Transactions** filters para hindi mawala ang pickups; " +
      "koleksyon sa **Add Collection** kung kelan babalik ang gallons.",
  },
];

function tokenize(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

function scoreKnowledgeEntry(entry: SupportKnowledgeEntry, queryTokens: string[]): number {
  if (!queryTokens.length) return 0;
  const haystack = `${entry.topic}\n${entry.content}`.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (entry.topic.toLowerCase().includes(token)) score += 6;
    if (haystack.includes(token)) score += 2;
  }
  return score;
}

function pickRelevantKnowledge(
  entries: SupportKnowledgeEntry[],
  focusQuery?: string,
  limit = SUPPORT_CONTEXT_ENTRY_LIMIT,
): SupportKnowledgeEntry[] {
  const queryTokens = tokenize(focusQuery || "");
  if (!queryTokens.length) return entries.slice(0, limit);
  const scored = entries
    .map((entry, idx) => ({
      entry,
      idx,
      score: scoreKnowledgeEntry(entry, queryTokens),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.idx - b.idx;
    });

  const best = scored.filter((s) => s.score > 0).slice(0, limit).map((s) => s.entry);
  if (best.length >= Math.min(6, limit)) return best;

  // Keep a few baseline entries for general coverage when query match is sparse.
  const fallback = entries
    .filter((e) => !best.some((b) => b.id === e.id))
    .slice(0, Math.max(0, limit - best.length));
  return [...best, ...fallback];
}

export function buildSupportKnowledgeContext(
  extraEntries: SupportKnowledgeEntry[] = [],
  focusQuery?: string,
): string {
  const allEntries = [
    ...SUPPORT_FAQ_ENTRIES,
    ...SUPPORT_PRODUCT_DOC_ENTRIES,
    ...extraEntries,
  ];
  const selectedEntries = pickRelevantKnowledge(allEntries, focusQuery);
  const faqBlock = selectedEntries
    .map((e) => `### ${e.topic}\n${e.content}`)
    .join("\n\n");

  return (
    `${SUPPORT_APP_WORKFLOWS}\n\n` +
    `${SUPPORT_PRODUCT_DOCUMENTATION}\n\n` +
    `## FAQs\n\n${faqBlock}`
  );
}
