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
      "delivery date, payment method, and optional rider. Save to create a pending delivery job. " +
      "If a matching **video tutorial** exists (see live catalog), recommend opening Tutorial videos " +
      "or /dashboard?tutorial={id} so they can follow along while recording.",
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
      "before they become transactions.",
  },
  {
    id: "subscription-plans",
    topic: "Subscription plans",
    content:
      "Starter has core features with limits. Grow adds team hub and live human support. " +
      "Scale/Enterprise add higher limits and advanced operations. " +
      "Check Account → Subscription for your plan, usage, auto-renew, and billing account status.",
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
    topic: "Auto-renew and link payment account",
    content:
      "Leave **Auto-renew my plan each billing cycle** checked to stay on your paid plan. " +
      "Use **Link payment account** on Account → Subscription to save GCash, Maya, or card for automatic " +
      "renewal charges when wallet billing is enabled. Without a linked wallet, you get a payment link " +
      "reminder a few days before your period ends.",
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
    `${formatRiverAiKnowledgeManifestBlock()}\n\n` +
    `${SUPPORT_EQUIPMENT_KNOWLEDGE}\n\n` +
    `${SUPPORT_WATER_SCIENCE_KNOWLEDGE}\n\n` +
    `${SUPPORT_APP_WORKFLOWS}\n\n` +
    `${SUPPORT_PRODUCT_DOCUMENTATION}\n\n` +
    `## FAQs\n\n${faqBlock}`
  );
}
