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
  **Delivery products** (sidebar **Products**) are what staff and sukis pick on
  new orders: price, active, QR visibility, default pick, Sales Portal gallon icon, and warehouse links to any inventory item. If Products has
  nothing to link, **Add inventory first** opens Register item without leaving the product form. Add/edit inventory no longer asks for a catalog role. The page uses the same layout as
  Suki (search, Inventory, and Add product in a toolbar). Open **Inventory** from that toolbar for warehouse stock.
  Products flags **No item linked**, a missing linked warehouse item, not enough / low stock on that item, or **No price**.
  Turn on **Default** for one product so QR, Record order, Walk-in sale, and Counter POS start with it when the suki has no preferred / special-price
  products. On the customer QR order, overflowing product pills use **More** / **Back** to slide between sets. **Review & Accept** shows a Products list (not Water refills + Item dispatch) when lines match Products; old water-type orders still show Item dispatch. Store items skip gallon dispatch. Walk-in and Counter POS **Water refill** show refill products; **Store items** show products marked Store item only (Walk-in also lists warehouse stock). Inactive products stay off new orders; old refill names on past deliveries do not change. **Record order** uses Products; turn on **Collect**
  to record returning items. If products failed to load, are missing, or are all inactive, Record order
  shows an inline note to update them on Products (not shown on customer QR). The note waits until products finish loading. Catalog no longer has **Delivery add-on items**; leftover \`deliveryInventorySalesEnabled\` may still attach priced Round/Slim/supplies
  on the customer QR portal and auto-fill the gap when refills exceed the suki's owned Round/Slim count.
  Per-suki **Containers** can be turned on with no quantity. Preferred products such as Slim Purified show Slim or Round; the suki list and profile still show them at 0 pcs. Orders can add gallons later. Each container row with a quantity has **Deduct from stock**. Container agreement is on the suki profile, not the Add/Update form.
  CRM delivery address, latitude, and longitude are optional — you can save a suki with just a name.
  **Special prices** on a suki profile pick from Products; old water-type keys (like alkaline) still apply.
  On **Record order**, those preferred products start already selected (qty 1, Preferred badge).
  Each gallon product can check **Expect empty back** on Record order and Review & Accept so the stop expects that empty container (qty matches the product). Own-gallon (BYOG) sukis start unchecked; station-gallon sukis start checked. The product must be linked to an inventory item. Store items have no checkbox. Walk-in and Counter POS do not show the checkbox.
  Turn on **Collect** and the matching Slim or Round return line is already picked.
  Inventory no longer has a default ₱ deposit per WRS shell; record a suki deposit on their profile when you need it.
  Delete/restock update the list immediately; CRUD/restock sends in-app notifications.
- **Saving** (create/edit/delete): all business changes go through Smart Refill's secure server;
  the dashboard sends the change, then live lists update.
- **Plan & notifications**: subscription status and the notification bell use API reads on a schedule.
- **Exports & statements**: bulk print/export use live workspace data instead of large list API calls.

### Video tutorials (follow-along)
- Owners open **Tutorial videos** from the sidebar (desktop) or **Help & support** → Video tutorials
  on the Android/iOS app (and phone web).
- After first station setup, **Quick actions** opens and stays open (no X): suki and delivery are required; walk-in and expense have Skip. Walk-in is a counter sale labeled Walk-in, not the suki from the previous step.
  Finishing that walkthrough goes to Daily Operation. After that, Quick actions is the usual picker. Tutorial videos stay in Help / the sidebar.
- Published how-to videos come from Smart Refill training content; Play keeps a coach player
  on screen while working. Deep link: /dashboard?tutorial={videoId}.
- New publishes notify owners in the activity feed; verified emails get a Watch link.
- **River AI Buddy** should recommend matching published tutorial titles from the live catalog.

### Sign-in, verification & onboarding
- Sign in with email/password or Google.
- After login, Daily Operation opens once your station is ready. Plan limits and extra lists
  keep loading in the background. Welcome back should not sit forever. If the station never
  loads, you get Connection Error and Back to Login — not a page that says it could not load.
- **Google on mobile** uses a full-browser redirect (not a popup) for reliability.
- **Google inside Facebook Messenger, Instagram, or other in-app browsers is blocked by Google**
  (Error 403 disallowed_useragent). Open the Smart Refill link in **Safari or Chrome**
  (tap menu → Open in browser), then sign in again.
- **Local development**: localhost uses its own auth domain so Google sign-in stays on your machine.
- New owners: verify email → complete station onboarding (mobile app uses a full-screen 3-step setup:
  Station, Products, Payments) → dashboard. Step 2 suggests **Round Purified**, **Slim Purified**,
  **Round Alkaline**, and **Slim Alkaline** (edit prices or remove). Round names show the round
  gallon icon; Slim names show the slim gallon icon; add another product to pick an icon.
  Step 3 is **Payment Accounts**
  (same Type, Provider, Holder, Account #, Primary, and QR fields as Account). Cash is always
  available; you can skip and add later in Account.
  Finish copies products into Products and filled payout accounts into Payment settings.
  **Quick actions** then opens first (required suki + delivery; Skip on walk-in and expense), even if this station walked through it before;
  finishing that walkthrough goes to Daily Operation.
- Invited staff: accept Team Hub invite link → verify email if needed → staff onboarding →
  **My Area** (riders) or **dashboard** (admins).
- **Team Hub directory records** (Scale / Enterprise only): owner can add personnel
  **without email or login** — name, optional photo/phone, role — for directory and dispatch
  assignment only. These rows do **not** use a staff seat, do **not** get Messenger link,
  My Area, or live GPS. Starter / Grow / free mode cannot add directory records.
- If you are sent back to onboarding after you already finished: try sign out and sign in;
  confirm you are on the correct station/workspace; use **Profile → Chat support** if it persists
  (account may show complete but station profile may still need a step).
- **Sharing statements or rider trackers from the Android/iOS app** uses public links
  (app.smartrefill.io), not an internal localhost address. On phone, Save PDF / Share summary
  replaces desktop print popups.
### Transaction ledger (Transactions page)
- **Search** ledger by customer name, reference ID, notes, or amount.
- **Volume column** lists product names (and older refill names when there is no product match).
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
- **Subscription billing (July 2026)** — Account → Subscription or Pricing checkout: pay with **GCash or Maya** online; **Allow auto-renew** (default on) links the payment account during that pay so the next cycle can charge automatically; without vaulting, we send a payment link before the period ends. Manual bank transfer + proof still available. Renew checkout **includes current add-ons by default**; stacked renewals schedule the next period if you already paid ahead.
- **Header River AI** (orb on desktop/tablet; mobile bottom-nav Buddy orb): AI-only Buddy for Smart Refill app + water station operations (plan chat caps). Common greetings, FAQs, and how-tos may answer without calling Gemini; live sales numbers and screenshots still use Gemini.
- **Profile → Chat support**: live Brevo helpdesk for billing and account issues (Grow+ when enabled)—
  completely separate from River AI Buddy (no handoff from Buddy into Brevo).
- **Analytic Hub / owner AI tools**: separate aiTools quota—not the same as River AI support chat.
  Intel tools and AI scans may be temporarily under maintenance; **River AI Buddy chat stays available**.
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
    id: "doc-onboarding-payments",
    topic: "Setup: GCash at bank account",
    content:
      "Huling hakbang ng station setup ay **Payment Accounts** (pareho ng Account). Ilagay ang GCash " +
      "o bank, i-set ang Primary, at optional QR. Laging available ang cash sa orders. " +
      "Pwedeng i-skip at idagdag mamaya sa Account → Payment Accounts.",
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
      "Sa **Team Hub → Onboard New**, piliin **Directory record** (Scale / Enterprise lang; dating " +
      "**Access credential not needed**) para magdagdag ng personnel sa directory nang walang email invite " +
      "o app login. Hindi ito kumukuha ng staff seat at **walang Messenger link**. Ilagay ang pangalan, " +
      "optional photo/phone, at role (rider o admin contact). Makikita sa directory at pwedeng i-assign " +
      "sa delivery, pero **walang My Area** at **walang live GPS**. Starter / Grow / free mode ay walang " +
      "Directory record. Para sa riders na kailangan ng app o Messenger, gamitin ang Create account o Send invitation.",
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
      "Iwanan naka-check ang **Allow auto-renew** (default) — kapag nagbayad ka, na-li-link ang payment account para automatic charge sa next cycle kung supported. " +
      "Kung hindi available ang wallet linking, makakatanggap ka ng in-app reminder na may payment link bago matapos ang period. " +
      "Sa renew, kasama na ang **add-ons** ng current plan — pwedeng i-off o bawasan sa checkout. " +
      "Kung nabayaran mo na ang susunod na buwan, ang bagong renew ay **sunod na period** (hindi duplicate month). " +
      "Manual transfer: i-expand ang **Pay manually instead** at mag-upload ng proof. " +
      "Online checkout ay **subscription lang** — hindi para sa portal order payments o ledger collections.",
  },
  {
    id: "doc-video-tutorials",
    topic: "Paano manood ng video tutorial sa app?",
    content:
      "Buksan ang **Tutorial videos** sa left sidebar o floating Tutorial button. " +
      "Pumili ng lesson at Play — follow-along player mananatili habang nagtatrabaho. " +
      "Direct: /dashboard?tutorial={videoId}. " +
      "Kapag may bagong tutorial, may activity-feed alert; verified email owners may Watch link. " +
      "River AI Buddy can cite live published tutorial titles when helping with how-to questions.",
  },
  {
    id: "doc-river-ai-vs-live-support",
    topic: "River AI vs Chat support — saan pumunta?",
    content:
      "Header **River AI** (orb): tanong tungkol sa app at operasyon ng station—AI-only Buddy. " +
      "Profile menu → **Chat support**: live helpdesk para sa billing, account, at escalated issues. " +
      "Walang handoff mula Buddy papuntang Chat support — hiwalay na entry ang dalawa. " +
      "Hiwalay ang Analytic Hub AI tools sa River AI support chat quota. " +
      "Puwede pa rin ang River AI Buddy kahit naka-maintenance ang ibang AI tools.",
  },
];
