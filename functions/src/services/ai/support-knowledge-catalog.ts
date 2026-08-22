/**
 * Curated FAQ + in-app process knowledge for River AI support (dashboard context).
 * Product documentation summaries: ./product-documentation-knowledge.ts
 * (sync with smartrefill-v3/docs/).
 */

import {
  SUPPORT_PRODUCT_DOCUMENTATION,
  SUPPORT_PRODUCT_DOC_ENTRIES,
} from "./product-documentation-knowledge";

import {
  SUPPORT_EQUIPMENT_FAQ,
  SUPPORT_EQUIPMENT_KNOWLEDGE,
} from "./support-equipment-knowledge";
import { formatRiverAiKnowledgeManifestBlock } from "./river-ai-knowledge-manifest";
import { SUPPORT_AI_PERSONA } from "./support-persona-roles";
import {
  SUPPORT_WATER_SCIENCE_FAQ,
  SUPPORT_WATER_SCIENCE_KNOWLEDGE,
} from "./support-water-science-knowledge";
import type { SupportKnowledgeEntry } from "./support-knowledge-types";

export { SUPPORT_AI_PERSONA };
export type { SupportKnowledgeEntry } from "./support-knowledge-types";

const SUPPORT_CONTEXT_ENTRY_LIMIT = 20;

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
- New owners finish Station, Products, then Payments (GCash / bank). Cash is always available.
  Payout details can be skipped and added later in Account → Payment settings.
- Owners manage subscription, billing, team invites, and full settings under Account.

### Video tutorials (follow-along)
- **Tutorial videos** panel: sidebar (desktop) or floating Tutorial button (mobile).
- Catalog lists published how-to videos from Smart Refill (Sales Portal training videos).
- Press Play to follow along — a small coach player stays on screen while you work
  (add delivery, edit sukis, switch pages).
- New published tutorials notify owners in the activity feed; verified emails get a Watch link.
- Deep link: /dashboard?tutorial={videoId} opens that video.

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
- **Products** (sidebar): delivery catalog for Record Delivery, walk-in, and QR. Search, Inventory,
  and Add product sit in a toolbar like the suki list. Set price, active, “show in customer order”,
  default pick (one product), icon, and optional warehouse SKUs. Walk-in and Counter POS Water refill
  lists refill products; Store items lists Store item only products (Walk-in also lists warehouse stock). Water types seed into Products
  on first visit and stay as a derived list for older orders. New station setup step 2 suggests Round Purified,
  Slim Purified, Round Alkaline, and Slim Alkaline with matching gallon icons (add another product to pick an icon).
  Account → Catalog no longer has Delivery add-on items;
  use Products (including Store item only) for extras on orders. Walk-in counter QR stays under Catalog.

### Submissions / portal
- Review customer portal requests (orders, collections, profile updates) before they apply to
  records.

### Subscriptions & support
- Plans: Starter, Grow, Scale, Enterprise — features vary (team hub, live human chat, AI credits for
  other in-app AI tools).
- Support: River AI Buddy (header) is AI-only for app and water station topics; live helpdesk is
  **Profile → Chat support** (Brevo) — a separate entry, not a Buddy handoff.
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
      "Go to Transactions → Add Delivery. Pick a customer, products/quantities, " +
      "delivery date, payment method, and optional rider. Save to create a pending delivery job. " +
      "Manage offerings under Products in the sidebar (price, active, QR visibility). " +
      "When you pick a suki, their Special price products are already added on Record order. " +
      "Check Expect empty back on a gallon product (Record order or Review & Accept) when the suki should return that empty container. " +
      "Own-gallon (BYOG) sukis start unchecked; station-gallon sukis start checked. " +
      "Turn on Collect and the matching Slim or Round return line is already picked. " +
      "If a matching **video tutorial** exists (see live catalog), recommend opening Tutorial videos " +
      "or /dashboard?tutorial={id} so they can follow along while recording.",
  },
  {
    id: "add-products",
    topic: "How do I add a product?",
    content:
      "Open Products from the sidebar (or the phone dock). Search the catalog in the toolbar, " +
      "or tap Add product for a name and price, choose a Sales Portal gallon icon, and turn on Show in customer order " +
      "if sukis should see it on the QR page. New station setup already suggests Round Purified, " +
      "Slim Purified, Round Alkaline, and Slim Alkaline with matching gallon icons — edit those on Products after you finish. " +
      "Turn on Default for the one product that should be " +
      "pre-selected on QR and Record order when the suki has no preferred products. " +
      "If there is no warehouse item to link, tap Add inventory first in that same form. " +
      "Tap Inventory in the Products toolbar to manage warehouse stock. " +
      "You can link warehouse items so stock deducts when that product sells. Refill-only products " +
      "do not touch warehouse stock. Old water types are copied here the first time you open the page. " +
      "On a suki profile, Special prices lists those products; old water-type rates (like alkaline) still apply. " +
      "Record order starts with those preferred products already selected. " +
      "Check Expect empty back on a gallon product (Record order or Review & Accept) when the suki should return that empty container. " +
      "Own-gallon (BYOG) sukis start unchecked; station-gallon sukis start checked. " +
      "Turn on Collect and the matching Slim or Round return line is already picked. " +
      "On Add/Update suki, Containers can be on with no quantity. Preferred products such as Slim Purified show Slim or Round; " +
      "orders can add gallons later. Each row with a quantity has Deduct from stock. " +
      "Container agreement is on the suki profile, not that form. " +
      "Account → Catalog no longer has Delivery add-on items — use Products (including Store item only) " +
      "for extras on orders. Walk-in counter QR and manual reference numbers stay under Catalog.",
  },
  {
    id: "onboarding-payment-methods",
    topic: "Add GCash or bank during setup",
    content:
      "Station setup step 3 is Payment Accounts — the same Type, Provider, Holder, Account #, " +
      "Primary, and QR fields you later edit in Account → Payment Accounts. Add GCash or a bank. " +
      "Cash is always available on orders and is not stored as a payout account. You can skip " +
      "and add methods later in Account. Finishing setup saves filled accounts to the station payment list.",
  },
  {
    id: "onboarding-quick-actions-first",
    topic: "Ano ang unang lalabas pagkatapos ng setup?",
    content:
      "After Finish setup, Quick actions opens first and stays open — there is no X. " +
      "Register a suki and a delivery first. Walk-in and expense have Skip. " +
      "The walk-in step is a counter sale (Walk-in), not that suki. " +
      "When you finish that walkthrough, you go to Daily Operation. " +
      "After that, Quick actions is the usual picker (close and choose any step). " +
      "If you finish setup again on the same station, the required walkthrough opens again. " +
      "Stations that already finished setup and are not going through setup again are not changed. Tutorial videos stay in Help / the sidebar.",
  },
  {
    id: "catalog-delivery-addons-removed",
    topic: "Wala na ang Delivery add-on items sa Catalog",
    content:
      "Tama — tinanggal na ang Delivery add-on items sa Account → Catalog. " +
      "Para sa extras sa order (faucet, supplies, Store item), gamitin ang Products. " +
      "Nandoon pa rin ang Walk-in counter QR at manual reference numbers sa Catalog.",
  },
  {
    id: "video-tutorials",
    topic: "Saan ang video tutorials / paano manood ng how-to?",
    content:
      "Open **Tutorial videos** mula sa left sidebar (desktop) o floating Tutorial button (mobile). " +
      "Pumili ng lesson, tap Play — mananatili ang maliit na coach player habang nagtatrabaho ka sa app. " +
      "Kapag may bagong tutorial, may activity-feed notification; verified email owners may Watch link. " +
      "Direct link: /dashboard?tutorial={videoId}. " +
      "River AI Buddy should cite published tutorial **titles** from the live catalog when relevant.",
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
      "before they become transactions. Review & Accept shows a Products list when lines match " +
      "Products; older water-type orders still show Water refills and Item dispatch. Store items " +
      "are not treated as gallon containers. If many products are listed, tap More to slide to " +
      "the rest and Back to return.",
  },
  {
    id: "subscription-plans",
    topic: "Subscription plans",
    content:
      "Starter has core features with limits. Grow adds team hub and live human support. " +
      "Scale/Enterprise add higher limits and advanced operations. " +
      "Check Account → Subscription for your plan, usage, and auto-renew status (Cancel / Keep My Plan). " +
      "At checkout, leave **Allow auto-renew** checked so paying GCash/Maya also links wallet billing for the next cycle.",
  },
  {
    id: "subscription-checkout",
    topic: "Pay subscription with GCash or Maya",
    content:
      "From Pricing or Account → Subscription, open checkout and choose **Pay with GCash or Maya**. " +
      "Your plan activates when payment is confirmed. Manual QR/bank transfer is still available under " +
      "**Pay manually instead**.",
  },
  {
    id: "subscription-auto-renew",
    topic: "Allow auto-renew at checkout",
    content:
      "Leave **Allow auto-renew** checked when you pay (default). That payment links your GCash, Maya, or card " +
      "so the next billing cycle can charge automatically when wallet billing is enabled. Without vaulting, " +
      "you get a payment link reminder a few days before your period ends. Cancel anytime from Account → Subscription.",
  },
  {
    id: "subscription-renew-addons",
    topic: "Renew with add-ons",
    content:
      "When renewing, your current station add-ons are included by default in checkout — turn add-ons off " +
      "or reduce quantities if you do not need them. If you already paid for the next billing period, " +
      "another payment schedules the following period instead of duplicating the same month.",
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
    id: "river-ai-tools-maintenance",
    topic: "River AI tools under maintenance / bakit hindi gumagana ang AI tools?",
    content:
      "River AI Buddy chat is available. Owner intel tools (morning brief, collections pulse, " +
      "dispatch health, warehouse risk, retention, plant health) and AI scans are temporarily " +
      "under maintenance. File imports and duplicate detection without AI still work. " +
      "Use the header River AI orb or the mobile Buddy button for help.",
  },
  {
    id: "human-support",
    topic: "Talk to a human / live helpdesk",
    content:
      "River AI Buddy is AI-only. For the live helpdesk (billing, account, escalated issues), " +
      "open **Profile menu → Chat support**. That chat is separate from Buddy and does not " +
      "hand off from this conversation.",
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
  {
    id: "river-ai-ops-commands",
    topic: "River AI staff commands (voice or chat)",
    content:
      "Say or type: \"List customers with balance\", \"Add delivery for Ana 5 gallons bukas\", " +
      "\"Record payment ₱500 for TX-123\", \"Mark TX-123 delivered\", \"Adjust stock caps by +10\". " +
      "Writes show a draft — tap **Confirm** to save. Prefix `/ops` to force staff mode.",
  },
  {
    id: "growth-brainstorm",
    topic: "Paano pa palaguin ang WRS",
    content:
      "Common levers: win-back inactive suki (Forecast tab), tighten collection cadence, " +
      "route density for riders, portal QR for reorders, promo bundles (family/gallon), " +
      "and consistent delivery windows. Use live snapshot utang + inactive counts to prioritize.",
  },
  ...SUPPORT_EQUIPMENT_FAQ,
  ...SUPPORT_WATER_SCIENCE_FAQ,
];

/**
 * Minimum score for a Buddy preflow cache hit (skip Gemini).
 * Tuned to catch clear FAQ / doc overlaps while still rejecting weak noise.
 */
export const SUPPORT_KNOWLEDGE_HIGH_CONFIDENCE_MIN = 12;

/** Extra score when the query contains a known how-to phrase for a FAQ/doc entry. */
const KNOWLEDGE_PHRASE_BOOSTS: Array<{ re: RegExp; boost: number }> = [
  { re: /\b(add|create|mag-?add|gumawa|record)\b.{0,24}\b(deliver|delivery|order)\b/i, boost: 8 },
  { re: /\b(add|create|mag-?add|gumawa)\b.{0,24}\b(collection|koleksyon|pickup)\b/i, boost: 8 },
  { re: /\b(invite|mag-?invite)\b.{0,20}\b(staff|rider|team)\b|\bteam\s*hub\b/i, boost: 8 },
  { re: /\b(tutorial|video\s+tutorial|how-?to\s+video|manood)\b/i, boost: 6 },
  { re: /\b(qr\s*portal|customer\s+portal|portal\s+order)\b/i, boost: 6 },
  { re: /\b(gcash|maya|auto-?renew|subscription|magbayad\s+ng\s+plan)\b/i, boost: 6 },
  { re: /\b(offline|brownout|walang\s+signal|sync\s+queue)\b/i, boost: 6 },
  {
    re: /\b(inventory|stocks?|containers?)\b.{0,16}\b(add|setup|mag-?add)\b/i,
    boost: 6,
  },
  { re: /\b(add|setup)\b.{0,16}\binventory\b/i, boost: 6 },
  { re: /\b(walk-?in|record\s+order)\b/i, boost: 5 },
  { re: /\b(my\s+area|rider\s+app)\b/i, boost: 5 },
];

export type SupportKnowledgeHitSource = "faq" | "confirmed" | "tutorial" | "doc";

export type SupportKnowledgeHit = {
  entry: SupportKnowledgeEntry;
  score: number;
  source: SupportKnowledgeHitSource;
};

function tokenize(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

function parseStoredQa(content: string): { question: string; answer: string } | null {
  const match = content.match(/^Q:\s*([\s\S]+?)\nA:\s*([\s\S]+)$/i);
  if (!match) return null;
  const question = match[1].trim();
  const answer = match[2].trim();
  if (!question || !answer) return null;
  return { question, answer };
}

function knowledgeHitSource(entry: SupportKnowledgeEntry): SupportKnowledgeHitSource {
  if (entry.id.startsWith("learned-") || parseStoredQa(entry.content)) {
    return "confirmed";
  }
  if (entry.id.startsWith("tutorial-") || /tutorial/i.test(entry.topic)) {
    return "tutorial";
  }
  if (entry.id.startsWith("doc-")) return "doc";
  return "faq";
}

function scoreKnowledgeEntry(
  entry: SupportKnowledgeEntry,
  queryTokens: string[],
  rawQuery = "",
): number {
  if (!queryTokens.length) return 0;
  const topic = entry.topic.toLowerCase();
  const haystack = `${entry.topic}\n${entry.content}`.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (topic.includes(token)) score += 6;
    if (haystack.includes(token)) score += 2;
  }

  const stored = parseStoredQa(entry.content);
  if (stored) {
    const qTokens = tokenize(stored.question);
    const overlap = queryTokens.filter((t) => qTokens.includes(t)).length;
    score += overlap * 5;
    if (overlap >= 2 && overlap / Math.max(queryTokens.length, 1) >= 0.5) {
      score += 8;
    }
  }

  // Whole-phrase lean: "add delivery" vs topic "How do I create a delivery?"
  const queryJoined = queryTokens.join(" ");
  if (queryJoined.length >= 8 && topic.includes(queryJoined)) {
    score += 10;
  }

  // Intent phrases boost matching FAQ/doc rows so clear app how-tos skip Gemini.
  if (rawQuery) {
    for (const { re, boost } of KNOWLEDGE_PHRASE_BOOSTS) {
      if (!re.test(rawQuery)) continue;
      // Only apply when the entry is actually about that intent.
      if (re.test(`${entry.topic} ${entry.content}`)) {
        score += boost;
      }
    }
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
      score: scoreKnowledgeEntry(entry, queryTokens, focusQuery || ""),
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

/**
 * High-confidence FAQ / confirmed-Q&A match for Buddy preflow (skip Gemini).
 * Prefer cache when score is clear; still require meaningful token overlap.
 */
export function findHighConfidenceKnowledgeHit(
  entries: SupportKnowledgeEntry[],
  query: string,
  minScore = SUPPORT_KNOWLEDGE_HIGH_CONFIDENCE_MIN,
): SupportKnowledgeHit | null {
  const queryTokens = tokenize(query);
  // Single strong tokens (e.g. "tutorials") can still hit when phrase/topic score is high.
  if (queryTokens.length < 1) return null;

  let best: SupportKnowledgeHit | null = null;
  for (const entry of entries) {
    const source = knowledgeHitSource(entry);
    const score = scoreKnowledgeEntry(entry, queryTokens, query);
    // Confirmed owner Q&A can clear a slightly lower bar (already human-validated).
    // Single-token queries need a higher bar to avoid accidental FAQ hits.
    let threshold = source === "confirmed" ? Math.max(10, minScore - 2) : minScore;
    if (queryTokens.length === 1) {
      threshold = Math.max(threshold + 4, 16);
    }
    if (score < threshold) continue;
    if (!best || score > best.score) {
      best = { entry, score, source };
    }
  }
  return best;
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
    `${formatRiverAiKnowledgeManifestBlock()}\n\n` +
    `${SUPPORT_EQUIPMENT_KNOWLEDGE}\n\n` +
    `${SUPPORT_WATER_SCIENCE_KNOWLEDGE}\n\n` +
    `${SUPPORT_APP_WORKFLOWS}\n\n` +
    `${SUPPORT_PRODUCT_DOCUMENTATION}\n\n` +
    `## FAQs\n\n${faqBlock}`
  );
}
