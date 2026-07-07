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
  Catalog roles: **Round** and **Slim** (one each, customer-owned sales), **rotation shell** (WRS borrow/return),
  kit parts, general supplies. **Delivery add-on items** (Account → Catalog) enables priced Round/Slim/supplies on
  delivery and portal orders; when refills exceed suki's owned Round/Slim count, add-ons auto-fill the gap.
  Delete/restock update the list immediately; CRUD/restock sends in-app notifications.
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
- **Local development**: localhost uses its own auth domain so Google sign-in stays on your machine.
- New owners: verify email → complete station onboarding → dashboard.
- Invited staff: accept Team Hub invite link → verify email if needed → staff onboarding →
  **My Area** (riders) or **dashboard** (admins).
- **Team Hub record-only**: owner can add personnel **without email or login** (toggle
  "Access credential not needed") — name, optional photo/phone, role — for directory and dispatch
  assignment only. These riders do **not** get My Area or live GPS.
- If you are sent back to onboarding after you already finished: try sign out and sign in;
  confirm you are on the correct station/workspace; use **Talk to human agent** if it persists
  (account may show complete but station profile may still need a step).

### Transaction ledger (Transactions page)
- **Search** ledger by customer name, reference ID, notes, or amount.
- **Tabs/filters** for sales/walk-in, delivery, collection, expenses; status filters for
  order placed, pending, in transit, completed, etc.
- **Time filter**: today (default), yesterday, week, month, upcoming, or custom range.
- **Decimal unit prices** on refill rows (Record order, delivery, walk-in): centavos like ₱24.50.
- **Total Revenue / Total Net** headline totals count **in-period income only**; collections on
  older completed stops appear under **Past orders** in See breakdown. Tap Past orders to filter.
- **Ledger subtype labels** distinguish QR portal, community messenger, walk-in queue, and direct sale.
- **Walk-in sales** — container picker on Record order; inventory deducts containers/supplies **only when paid**.

### Operations hub (Dashboard → Operations hub tab, owner only)
- **Overview strip**: 14-day revenue trend, portal funnel (30-day placed → delivered),
  multi-station benchmark when you manage 2+ branches.
- **Daily averages row**: avg transactions/day, deliveries & collections/day, production volume/day,
  profit/day — month-to-date or last 30 days when the month just started.
- **Profit card**: Today and month tabs; **projected month-end profit** from scheduled stops and
  suki visit-pattern forecast (same engine as Forecast); **River AI observes** — short profit-health
  read (pace vs last month, risks, quiet sukis) without extra AI credits.
- **Deliveries & collections card**: pending, in-transit, completed counts; compact subtitle shows
  only non-zero buckets.
- **Transaction mix chart** includes delivery, walk-in, collection, expense, and **community order**
  (messenger channel) categories.
- **Customer health**, ratings, production, rider productivity charts below.

### Operations & field work
- **Operations** page: fleet, assign riders, cash reconciliation, performance, live dispatch map.
- **Offline-first ledger (June 2026)** — After one online sign-in, browse cached suki/inventory/jobs offline;
  queue walk-in sales, deliveries, and cash payments; auto-sync on reconnect. GCash stays pending until sync.
  Riders can complete stops offline with proof upload. Conflict UI when server and offline edits clash.
  Sign-in still requires internet; River AI and live maps need connection.
- **Dashboard map** (owners): beside daily stats—**all customers with a saved location** appear on the map.
  **Lime pin** = delivery in progress, **orange** = collection in progress, **red** = no active job.
- **My Area** (riders with login): today's route, **live map of all to-do stops**, driving route + ETAs,
  GPS ping to server, mark delivered/collected, proof & signature.
- **Record-only riders** (Team Hub directory, no login): can be assigned on deliveries but **cannot**
  open My Area or send GPS; portal **Track order** shows rider name and **En route** but **no live map**.
- **Track order** (customer order portal): linked riders with GPS — see rider pin + your address;
  message if rider has other stops; estimated arrival shown in the app (Google Directions).
- **Submissions**: approve customer portal and community orders before they become official transactions.

### Recent platform improvements (May–June 2026)
- Smoother dashboard—live customer/transaction/submission lists; shared inventory load.
- Dashboard customer map: lime/orange/red pins for delivery, collection, and idle customers.
- Operations hub: daily averages, projected profit, River AI profit observation, community order in mix.
- Team Hub record-only personnel for directory/dispatch without staff login.
- Portal track hides live map for record-only riders; shows En route status instead.
- Decimal centavo prices on refill unit rows; clearer ledger totals (in-period vs past orders).
- Walk-in stock deducts only on paid sales; clearer ledger subtype labels.
- **Offline-first ledger**: cached browse after sign-in; sync queue for walk-in/delivery/cash;
  rider offline complete with proof; conflict resolution; no duplicate txs on retry.
- River AI owner tools run on server-side Gemini (gemini-3.1-flash-lite default); requires GEMINI_API_KEY on the API in production.
- Manual Refresh no longer triggers heavy list downloads when data is already syncing.
- Fewer busy-hour errors when jumping between pages quickly.
- Clearer path to dashboard after sign-up (fewer onboarding loops).
- More consistent My Area for riders; refresh after completing a stop when needed.

### Plans & support channels
- **Starter / Grow / Scale / Enterprise** — team hub and live human chat on higher tiers.
- **Subscription billing (July 2026)** — Account → Subscription or Pricing checkout: pay with **GCash or Maya** online; optional **auto-renew** each cycle; **link payment account** to save wallet billing for automatic charges when enabled; manual bank transfer + proof still available. Renew checkout **includes current add-ons by default**; stacked renewals schedule the next period if you already paid ahead.
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
    id: "doc-team-hub-record-only",
    topic: "Team Hub: record-only personnel (walang login)",
    content:
      "Sa **Team Hub → Invite**, i-on ang **Access credential not needed** para magdagdag ng personnel " +
      "sa directory nang walang email invite o app login. Ilagay ang pangalan, optional photo/phone, at role " +
      "(rider o admin contact). Makikita sa directory at pwedeng i-assign sa delivery, pero **walang My Area** " +
      "at **walang live GPS**. Para sa riders na may phone at dapat mag-track, gamitin ang normal email invite.",
  },
  {
    id: "doc-ops-hub-kpis",
    topic: "Operations hub: daily averages, projected profit, River AI observes",
    content:
      "Sa **Dashboard → Operations hub** (owner): **Daily averages** row — avg transactions, stops, production volume, " +
      "at profit bawat araw (MTD o last 30 days). **Profit card** — Today/Month tabs; **Projected month-end profit** " +
      "mula sa scheduled stops at suki visit pattern (Forecast engine); **River AI observes** — maikling profit-health " +
      "read (pace vs last month, risks, quiet sukis) nang walang dagdag na AI credits. **Transaction mix** kasama ang " +
      "community messenger orders.",
  },
  {
    id: "doc-portal-track-record-only",
    topic: "Track order: walang live map pero En route",
    content:
      "Kung ang delivery ay naka-assign sa **record-only rider** (Team Hub directory, walang login), ang customer portal " +
      "**Track order** ay nagpapakita ng pangalan ng rider at **En route** status, pero **hindi live GPS map**. " +
      "Normal na riders na may My Area login ay may live pin at ETA. Sabihin sa owner na mag-invite ng rider account " +
      "kung kailangan ng customer tracking.",
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
      "'All time' kung hindi today. Delivery/collection tabs para i-filter ang type. **See breakdown** " +
      "sa Total Revenue/Net para sa Past orders collections.",
  },
  {
    id: "doc-my-area-rider",
    topic: "Rider: walang lalabas sa My Area",
    content:
      "Kailangan naka-assign ang delivery/collection sa rider account; tingnan ang date filter " +
      "(today). Pull to refresh kung available. Kung bagong assign, hintayin ilang segundo para sync. " +
      "**Record-only riders** (Team Hub directory) ay walang login—hindi sila makakapasok sa My Area.",
  },
  {
    id: "doc-live-tracking",
    topic: "Live tracking / track order / ETA",
    content:
      "Riders **with login**: buksan My Area, payagan ang GPS—makikita ang lahat ng to-do stops sa map at orange route. " +
      "Customers: Order portal → Track tab, ilagay ang reference ID—mapa ng rider at address mo kung may GPS login ang rider; " +
      "**En route lang** kung record-only rider. May paalala kung may ibang customers pa ang rider. " +
      "Estimated arrival sa app (hindi guaranteed). Owner: Operations share route para sa public tracker link (c page).",
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
    id: "doc-june-2026-release",
    topic: "Ano ang bago kamakailan (June 2026)?",
    content:
      "Offline-first ledger: browse cached suki at jobs pag walang signal; queue walk-in at delivery; " +
      "cash OK offline, GCash pending hanggang sync; rider pwedeng mag-complete offline with proof; " +
      "conflict resolution kung nagbago ang order online. Team Hub record-only personnel; Operations hub daily averages " +
      "at projected profit; River AI observes; community orders sa mix; portal track En route para sa directory riders.",
  },
  {
    id: "doc-offline-operations",
    topic: "Pwede ba magtrabaho offline / brownout?",
    content:
      "Oo, **partial offline** na (June 2026 DEV): mag-sign in muna **online** isang beses para ma-download ang cache. " +
      "Pag walang signal, makikita pa ang customers, inventory, at today's jobs (may stale banner). " +
      "Pwedeng mag-record ng walk-in sale, delivery, at cash payment — lalabas sa **Sync queue** at auto-sync pag bumalik ang internet. " +
      "GCash/bank transfer ay **pending sync** hanggang kumpirmado ng server. " +
      "Riders sa My Area: pwedeng mag-mark delivered/collected offline with proof photo. " +
      "Hindi pa offline: sign-in, River AI, live dispatch map, portal orders.",
  },
  {
    id: "doc-subscription-billing",
    topic: "Paano mag-renew, mag-upgrade, o mag-link ng GCash/Maya sa plan?",
    content:
      "Account → **Subscription** (o Pricing → checkout): piliin ang plan, **Pay with GCash or Maya** para sa secure online payment. " +
      "Iwanan naka-on ang **Auto-renew my plan each billing cycle** kung gusto mong magpatuloy pagkatapos ng period. " +
      "**Link payment account** — i-save ang GCash, Maya, o card sa payment partner para automatic charge sa renewal kung supported. " +
      "Kung walang naka-link na wallet, makakatanggap ka ng in-app reminder na may payment link bago matapos ang period. " +
      "Sa renew, kasama na ang **add-ons** ng current plan — pwedeng i-off o bawasan sa checkout. " +
      "Kung nabayaran mo na ang susunod na buwan, ang bagong renew ay **sunod na period** (hindi duplicate month). " +
      "Manual transfer: i-expand ang **Pay manually instead** at mag-upload ng proof. " +
      "Online checkout ay **subscription lang** — hindi para sa portal order payments o ledger collections.",
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
