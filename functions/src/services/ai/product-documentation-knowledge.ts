/* eslint-disable max-len */
/**
 * Product documentation knowledge for River AI support chat.
 * Keep in sync with `smartrefill-v3/docs/` (especially README, architecture-overview,
 * auth-flow, release-notes-business, frontend-documentation).
 */
/** Narrative block injected into every support prompt (summarized from official docs). */
export const SUPPORT_PRODUCT_DOCUMENTATION = `
## Official product documentation (summarized)

Use this section as authoritative Smart Refill product truth. Do not contradict it.

### How the app loads and saves data
- **Viewing** (lists on dashboard): customers, transactions, and pending portal submissions
  update **live** via Firestore while you work—Refresh does not re-download the full customer/ledger lists when sync is healthy.
- **Inventory**: one shared load per workspace (page and dialogs), not a request per screen.
- **Saving** (create/edit/delete): all business changes go through Smart Refill's secure server;
  the dashboard sends the change, then live lists update.
- **Plan & notifications**: subscription status and the notification bell use API reads on a schedule.
- **Exports & statements**: bulk print/export use live workspace data instead of large list API calls.

### Sign-in, verification & onboarding
- Sign in with email/password or Google.
- **Google on mobile** uses a full-browser redirect (not a popup) for reliability.
- **Google inside Facebook Messenger, Instagram, or other in-app browsers is blocked by Google**
  (Error 403 disallowed_useragent). Open the Smart Refill link in **Safari or Chrome**
  (tap menu → Open in browser), then sign in again.
- New owners: verify email → complete station onboarding → dashboard.
- Invited staff: accept Team Hub invite link → verify email if needed → staff onboarding →
  **My Area** (riders) or **dashboard** (admins).
- If you are sent back to onboarding after you already finished: try sign out and sign in;
  confirm you are on the correct station/workspace; use **Talk to human agent** if it persists
  (account may show complete but station profile may still need a step).

### Transaction ledger (Transactions page)
- **Search** ledger by customer name, reference ID, notes, or amount.
- **Tabs/filters** for sales/walk-in, delivery, collection, expenses; status filters for
  order placed, pending, in transit, completed, etc.
- **Time filter**: today (default), yesterday, week, month, upcoming, or custom range.

### Operations & field work
- **Operations**: fleet, assign riders, cash reconciliation, performance.
- **Dashboard map** (owners): beside daily stats—**all customers with a saved location** appear on the map.
  **Lime pin** = delivery in progress, **orange** = collection in progress, **red** = no active job.
- **My Area** (riders): today's route, **live map of all to-do stops**, driving route + ETAs,
  GPS ping to server, mark delivered/collected, proof & signature.
- **Track order** (customer order portal): see rider + your address only; message if rider
  has other stops; estimated arrival shown in the app (Google Directions).
- **Submissions**: approve customer portal orders before they become official transactions.

### Recent platform improvements (May–June 2026)
- Smoother dashboard—live customer/transaction/submission lists; shared inventory load.
- Dashboard customer map: lime/orange/red pins for delivery, collection, and idle customers.
- River AI owner tools run on server-side Gemini (gemini-3.1-flash-lite default); requires GEMINI_API_KEY on the API in production.
- Manual Refresh no longer triggers heavy list downloads when data is already syncing.
- Fewer busy-hour errors when jumping between pages quickly.
- Clearer path to dashboard after sign-up (fewer onboarding loops).
- More consistent My Area for riders; refresh after completing a stop when needed.

### Plans & support channels
- **Starter / Grow / Scale / Enterprise** — team hub and live human chat on higher tiers.
- **Header River AI** (orb button): AI help for Smart Refill app + water station operations (plan chat caps).
- **Profile → Chat support**: live Brevo helpdesk for billing and account issues (Grow+ when enabled)—
  separate from the header River AI button.
- **Talk to human agent** inside River AI chat: escalates the same dialog to Brevo when on Grow+.
- **Analytic Hub / owner AI tools**: separate aiTools quota—not the same as River AI support chat.
`;

/** FAQ-style entries derived from docs (indexed for retrieval in prompt). */
export const SUPPORT_PRODUCT_DOC_ENTRIES: Array<{
  id: string;
  topic: string;
  content: string;
}> = [
  {
    id: "doc-live-dashboard",
    topic: "Bakit hindi agad lumalabas ang bagong customer o transaction?",
    content:
      "Karaniwan **live update** ang customers, transactions, at portal submissions sa dashboard. " +
      "Kung wala pa rin pagkatapos ng ilang segundo, i-refresh ang page o mag-sign out/in. " +
      "Kung after **save** (bagong delivery, etc.), hintayin ang success message—dapat sumunod ang list.",
  },
  {
    id: "doc-onboarding-loop",
    topic: "Stuck sa onboarding kahit tapos na",
    content:
      "Minsan hiwalay ang **account ready** vs **station profile complete**. Subukan sign out/in. " +
      "Staff: dapat tama ang invite at staff onboarding. Kung paulit-ulit, i-escalate sa human agent " +
      "kasama station name at role (owner/admin/rider).",
  },
  {
    id: "doc-google-in-app-browser",
    topic: "Google sign-in blocked sa Messenger / Facebook browser",
    content:
      "Hindi pinapayagan ng Google ang sign-in sa loob ng **Facebook Messenger, Instagram, o in-app browser**. " +
      "Makikita ang 'Access blocked' o Error 403 disallowed_useragent. Solusyon: i-tap ang menu (⋯) → " +
      "**Open in browser** / **Open in Safari** o **Chrome**, buksan ang Smart Refill doon, tapos " +
      "subukang **Continue with Google** muli. Gumamit ng email/password kung hindi mabuksan sa browser.",
  },
  {
    id: "doc-slow-peak-hours",
    topic: "Mabagal o error sa peak hours",
    content:
      "Sa sobrang busy, maaaring mag-pause muna ang ilang report/plan loads para hindi ma-overload " +
      "ang system. Iwasan muna ang mabilis na pag-switch ng maraming filter nang sabay; " +
      "kung may 'rate limit' message, hintayin ~1 minuto at subukan muli.",
  },
  {
    id: "doc-mutations-vs-view",
    topic: "Maaari ba akong mag-edit direkta sa database?",
    content:
      "Hindi. Lahat ng business changes (customer, delivery, collection, payment) ay dapat sa app " +
      "para validated at naka-log. River AI cannot change your data—guide lang sa tamang screen.",
  },
  {
    id: "doc-search-transactions",
    topic: "Hanapin ang transaction sa ledger",
    content:
      "Transactions page → search bar (customer, REF ID, notes, amount). Gamitin time filter " +
      "'All time' kung hindi today. Delivery/collection tabs para i-filter ang type.",
  },
  {
    id: "doc-my-area-rider",
    topic: "Rider: walang lalabas sa My Area",
    content:
      "Kailangan naka-assign ang delivery/collection sa rider account; tingnan ang date filter " +
      "(today). Pull to refresh kung available. Kung bagong assign, hintayin ilang segundo para sync.",
  },
  {
    id: "doc-live-tracking",
    topic: "Live tracking / track order / ETA",
    content:
      "Riders: buksan My Area, payagan ang GPS—makikita ang lahat ng to-do stops sa map at orange route. " +
      "Customers: Order portal → Track tab, ilagay ang reference ID—mapa ng rider at address mo lang; " +
      "may paalala kung may ibang customers pa ang rider. Estimated arrival sa app (hindi guaranteed). " +
      "Owner: Operations share route para sa public tracker link (c page).",
  },
  {
    id: "doc-email-verification",
    topic: "Email verification link",
    content:
      "May dalawang uri: **station owner** (landing `/verified`) at **staff** — admin/rider (landing `/staff-verified`, may workspace name at role sa email). " +
      "Buksan ang link sa loob ng validity period; isang beses lang kadalasan. " +
      "Kung expired: sign in → Account → Security → Resend verification. Staff pagkatapos ng invite: parehong resend flow; pwede ring humingi sa station admin.",
  },
  {
    id: "doc-may-2026-release",
    topic: "Ano ang bago kamakailan (2026)?",
    content:
      "Mas mabilis na dashboard lists, mas stable sa peak hours, ayos sa onboarding loop, " +
      "at mas consistent na My Area para sa riders. Walang change sa paraan ng pag-record ng sale/delivery.",
  },
  {
    id: "doc-river-ai-vs-live-support",
    topic: "River AI vs Chat support — saan pumunta?",
    content:
      "Header **River AI** (orb): tanong tungkol sa app at operasyon ng station—AI ang sumasagot. " +
      "Profile menu → **Chat support**: live helpdesk para sa billing, account, at escalated issues. " +
      "Sa loob ng River AI, pwede ring **Talk to human agent** kung Grow+ plan. " +
      "Hiwalay ang Analytic Hub AI tools sa River AI support chat quota.",
  },
];
