# SmartRefill V3 API — Test layout

All automated tests live under `src/__tests__/` (QA protocol).

| Folder | Runner | Purpose |
|--------|--------|---------|
| `unit/` | Vitest | Services, utils, handlers (isolated mocks) |
| `integration/` | Vitest | HTTP routes via supertest, flow-style `*.bdd.test.ts` |
| `bdd/` | Playwright | Live API contract tests against emulator |

```bash
npm run test              # unit + integration (Vitest)
npm run test:unit
npm run test:integration
npm run test:bdd          # Playwright (requires API emulator on :5001)
npm run test:bdd:local    # build + emulators:exec + seed + BDD (from backend/)
npm run test:all
```

API base URL for BDD: `http://127.0.0.1:5001/aquaflow-management-suite/asia-southeast1/smartrefillV3Api` (`bdd-api.ts`).

**Swagger & Postman:** [frontend/docs/openapi-postman-guide.md](../../../../frontend/docs/openapi-postman-guide.md) — `DOCS_ADMIN_TOKEN`, `/docs?token=`, Postman `base_url` / `firebase_token`. Regenerate collection: `npm run docs:generate`.

### Auth email verification (owner vs staff)

- **Unit:** `unit/utils/staff-email-verification-template.test.ts` — staff HTML layout, workspace/role, Brevo tag `email_verification_staff`
- **Unit:** `unit/utils/email-verification-template.test.ts` — `getEmailVerificationEmail` routes owner vs staff
- **Unit:** `unit/utils/resolve-verification-audience.unit.test.ts` — `/verified` vs `/staff-verified`, audience + staff context from Firestore
- **Integration:** `integration/api.test.ts` — signup calls `sendVerificationEmail`
- **Docs / manual QA:** `frontend/docs/auth-email-verification-test-summary.md`, `auth-flow.md` (TC-AUTH-12, 13, 21–23)

### Google Sign-In (client-side Firebase OAuth)

Google OAuth runs in the **frontend only** (Firebase Auth). The API receives the same `POST /auth/login` / `GET /auth/status` calls after sign-in as email/password.

- **Unit (FE):** `frontend/src/__tests__/unit/lib/google-auth-environment.test.ts`, `unit/features/auth-ui/google-auth-client.test.ts`, `complete-google-auth.test.ts`
- **Unit (BE):** `unit/services/ai/product-documentation-knowledge.unit.test.ts` — River AI FAQ for Messenger/Instagram `disallowed_useragent`
- **Docs / manual QA:** `frontend/docs/google-auth-test-summary.md`, `auth-flow.md` (TC-AUTH-03, 24–27)

### Subscription lifecycle

- **Unit:** `unit/services/subscriptions/subscription-effective.unit.test.ts`
- **Unit:** `unit/utils/staff-seat-limit.unit.test.ts` — staff cap = rider + admin (owner excluded); add-on boosts
- **Unit:** `unit/services/team/team-hub-staff-count.unit.test.ts` — occupied count excludes owner
- **Unit:** `unit/services/team/workspace-member-access.unit.test.ts` — `isActiveStaffMemberForLimit`
- **Unit:** `unit/utils/subscription-addon-limit-boosts.unit.test.ts` — includes `extra_business` boosts
- **Unit:** `unit/utils/extra-business-addon-access.unit.test.ts` — Owner hub add-on slot reader
- **Unit:** `unit/services/support/support-ai-usage-service.unit.test.ts`
- **BDD:** `bdd/subscription.spec.ts`, `bdd/subscription-lifecycle.spec.ts`
- **BDD reset:** `POST /subscriptions/:businessId/dev/reset-trial` (emulator only) via `resetBusinessSubscriptionsToTrial()` in `bdd-api.ts`
- **Docs:** `frontend/docs/subscription-lifecycle.md`, `subscription-lifecycle-test-summary.md`
- **Catalog sync:** `npm run sync:subscription-plans` — writes `limitations.support` on `subscription_plans`

### Getting started sync

- **Unit:** `unit/getting-started-sync-service.test.ts` — collection detection (`payment_info`, inventory, etc.), patch merge
- **Integration:** `integration/getting-started-sync.bdd.test.ts` — `GET /business/:id/getting-started/sync`
- **Schema:** `frontend/docs/firestore_schema.md` (`gettingStarted`, `payment_info`)

### Platform feedback (`apps_feedback`)

- **Unit:** `unit/services/platform/platform-feedback-service.unit.test.ts` — `appId: smartrefill`, legacy `smartrefill-v3` normalization, `userFeedback` merge
- **Routes:** `POST /business/:businessId/platform-feedback`, `GET …/platform-feedback/me?appId=smartrefill`
- **Manual QA:** `frontend/docs/platform-feedback-test-summary.md`

### Portal orders & active suki limit

- **Unit:** `unit/services/portal/portal-customer-activation.unit.test.ts` — reactivate inactive suki on accept; blocked at cap (`PortalCustomerActivationBlockedError`)
- **Unit:** `unit/services/customers/customer-active-limit.unit.test.ts` — `countActiveCustomers`, `isCustomerActiveForLimit`
- **Unit:** `unit/services/portal/online-order-limit-service.unit.test.ts` — daily/monthly portal order throttle
- **Unit:** `unit/services/portal/raw-submission-place-order.unit.test.ts` — PLACE_ORDER accept payload
- **Wiring:** `raw-submission-processor.ts`, `raw-submission-handler.ts` call `ensureCustomerActiveForPortalAcceptance`
- **Docs / manual QA:** `frontend/docs/portal-customer-active-limit-test-summary.md` (TC-PORTAL-LIMIT-*)

### Portal live rider tracking (`portal_track_live`)

- **Unit:** `unit/services/portal/portal-track-live-service.unit.test.ts` — upsert on rider GPS; seed/clear on `deliveryStatus`
- **Unit:** `unit/services/riders/rider-tracking-service.unit.test.ts` — self-location POST triggers portal live upsert
- **Integration:** `integration/portal-track.test.ts` — public track GET (status/metadata)
- **Schema / rules:** `frontend/docs/firestore_schema.md` (`portal_track_live`); `frontend/firestore.rules` + `backend/firestore.rules` (public read)
- **Docs / manual QA:** `frontend/docs/operations-live-dispatch-test-summary.md` (TC-TRK-01, TC-TRK-11, TC-TRK-11b)

### Customer last fulfilled & dormant signals

- **Unit:** `unit/services/customers/customer-last-fulfilled-service.unit.test.ts` — `resolveFulfilledActivity`, `touchFromTransaction`, `backfillBusiness`
- **Unit:** `unit/utils/dormant-customers.unit.test.ts` — `buildDormantCustomerRows`, `buildDormantSignalsSnapshot` (AI `retention_pulse` snapshot)
- **Job:** `jobs/backfill-customer-last-fulfilled.ts` — nightly `backfillCustomerLastFulfilled` patches missing `customers.lastFulfilledAt`
- **Job:** `jobs/dormant-digest-notification.ts` — hourly `dormantDigestNotification` sends BL-01 dormant digest FCM at owner `dormantPushHour`
- **Job:** `jobs/morning-owner-intelligence.ts` — hourly `morningOwnerIntelligence` runs BL-07 auto `morning_brief` + BL-16 weekly Brevo email
- **Job:** `jobs/proactive-insight-push-notification.ts` — hourly `proactiveInsightPushNotification` sends NT-01–NT-04 pushes (payment, maintenance, variance, reorder) at owner send hour
- **Unit:** `unit/services/notifications/dormant-digest-service.unit.test.ts` — digest copy + send window
- **Unit:** `unit/utils/payment-reminder-queue.unit.test.ts`, `unit/utils/inventory-reorder-alert.unit.test.ts` — proactive push queue builders
- **Unit:** `unit/utils/notification-preferences.unit.test.ts` — sanitize `uiConfig` alert keys including plant/reorder toggles
- **Writes:** `transaction-service.ts` calls `CustomerLastFulfilledService.touchFromTransaction` on fulfill transitions
- **Docs:** `frontend/docs/firestore_schema.md`, `frontend/docs/dormant-customer-test-summary.md`, `frontend/docs/backend-documentation.md`

### River AI tools & Gemini config

- **Config:** `unit/services/ai/gemini-config.unit.test.ts` — default model `gemini-3.1-flash-lite`, ladder, env overrides
- **Usage goals:** `unit/utils/usage-goals.unit.test.ts` — normalize `businesses.usageGoals`, ranked intel tool recommendations
- **Unit:** `unit/services/ai/ai-tool-run-service.unit.test.ts` — snapshot includes `ownerUsageGoals`; prompts reference owner priorities
- **Integration BDD:** `integration/ai-tool-flow.bdd.test.ts` — `POST/GET /business/:id/ai-tools/runs`, fallback when `GEMINI_API_KEY` is unset; `POST …/duplicates/detect` and `POST …/duplicates/dismiss`
- **Duplicate suki:** `unit/services/ai/duplicate-customers-service.unit.test.ts` — heuristic clustering (phone, email, name; numeric phone coercion); `duplicate-customers-ai-validation-service.unit.test.ts` — Gemini filter; `duplicate-dismissals-service.unit.test.ts` — `dismissedDuplicateCustomerIds`, legacy group keys, `dismissDuplicateCustomer`
- **Local:** `GEMINI_API_KEY` in `functions/.env` (see `functions/.env.example`)

### Team chat (direct messages)

- **Unit:** `unit/services/team/team-chat-profanity-filter.unit.test.ts`, `team-chat-retention.unit.test.ts`, `team-chat-reactions.unit.test.ts`
- **Integration:** `integration/team-chat.test.ts` — `GET/POST/DELETE …/team/chats…`, reactions, `retentionDays`
- **Scheduled job:** `purgeExpiredTeamChats` (7-day rolling retention)
- **Docs / manual QA:** `frontend/docs/team-chat-test-summary.md`
