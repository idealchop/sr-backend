# SmartRefill V3 API

Lean **Express** API gateway on **Firebase Cloud Functions v2** (`functions:v3-api`, region **`asia-southeast1`**). Owns all Firestore mutations, validation, audit logging, and integrations (Brevo, Sharp, Gemini, etc.).

---

## Documentation

Canonical docs live in the frontend package:

| Topic | Path |
|-------|------|
| **Index** | [`../frontend/docs/README.md`](../frontend/docs/README.md) |
| Gateway, deploy, Gemini | [`../frontend/docs/backend-documentation.md`](../frontend/docs/backend-documentation.md) |
| **Swagger & Postman** | [`../frontend/docs/openapi-postman-guide.md`](../frontend/docs/openapi-postman-guide.md) |
| API reference | [`../frontend/docs/api-reference.md`](../frontend/docs/api-reference.md) |
| Firestore schema | [`../frontend/docs/firestore_schema.md`](../frontend/docs/firestore_schema.md) |
| Hybrid read model | [`../frontend/docs/hybrid-read-model.md`](../frontend/docs/hybrid-read-model.md) |
| Agent guide | [`../AGENTS.md`](../AGENTS.md) |

---

## Development

```bash
cd functions
cp .env.example .env    # SMARTREFILL_FIREBASE_* + DOCS_ADMIN_TOKEN + optional GEMINI_API_KEY
cp .secret.local.example .secret.local   # emulator Secret Manager overrides (see below)
npm install
npm run build
npm run serve:local    # http://localhost:8070 (live Firestore)
```

**Emulator 404 on `META_COMMUNITY_APP_SECRET`?** The Functions emulator fetches every secret listed in `src/index.ts` from Secret Manager unless you provide `functions/.secret.local`. Copy `.secret.local.example` → `.secret.local` and restart emulators. For production, run `firebase functions:secrets:set META_COMMUNITY_APP_SECRET`.

### Auth: `aud` claim mismatch (WFDC vs SmartRefill)

If logs show `Expected "waterfilter-dc-…" but got "aquaflow-management-suite"`, the API is verifying tokens with the **wrong** Firebase Admin credentials.

- Frontend tokens: project **`aquaflow-management-suite`** (`NEXT_PUBLIC_FIREBASE_PROJECT_ID`).
- Local API: **`SMARTREFILL_FIREBASE_*`** in `functions/.env` (see `.env.example`).
- Unset `GOOGLE_APPLICATION_CREDENTIALS` if it points at another project, then restart `serve:local`.

---

## Swagger UI & Postman

| Resource | Location |
|----------|----------|
| OpenAPI source | `functions/src/docs/openapi.ts` |
| Postman JSON | `functions/docs/postman-collection.json` |
| Regenerate | `cd functions && npm run docs:generate` |

### Access Swagger (interactive)

1. Set `DOCS_ADMIN_TOKEN` in `functions/.env`.
2. Start API (pick one):

```bash
# Emulator (same base URL as BDD tests)
npm run emulators:start
# or: firebase emulators:start --only functions,firestore,auth,storage
# → http://127.0.0.1:5001/aquaflow-management-suite/asia-southeast1/smartrefillV3Api/docs?token=<token>

# Or local Express
cd functions && npm run serve:local
# → http://localhost:8070/docs?token=<token>
```

3. Raw spec: append `/docs.json?token=<token>`.

Full steps, Postman environment variables (`base_url`, `firebase_token`, `businessId`, …), and troubleshooting: **[openapi-postman-guide.md](../frontend/docs/openapi-postman-guide.md)**.

---

## Testing

See [`functions/src/__tests__/README.md`](functions/src/__tests__/README.md).

```bash
cd functions
npm run lint:fix
npm run build
npm run test:unit
npm run test:integration
npm run test:bdd       # Playwright vs emulator
```

Emulator base URL: `http://127.0.0.1:5001/aquaflow-management-suite/asia-southeast1/smartrefillV3Api`.

### Community Messenger dispatch (local)

```bash
npm run community:local    # emulators + seed + simulate order (no deploy)
```

Docs: [`../frontend/docs/community-dispatch-test-summary.md`](../frontend/docs/community-dispatch-test-summary.md).

---

## Deploy

From `backend/`:

```bash
./deploy.sh
```

Pipeline: build → unit → integration → BDD (emulator) → lint → deploy **functions** (`v3-api` codebase) and **Firestore rules/indexes** (synced from frontend).

**Storage rules** are skipped by default — `aquaflow-management-suite` does not use Firebase Storage for app uploads (files go through the API). To deploy `frontend/storage.rules` after enabling Storage in the console:

```bash
DEPLOY_STORAGE_RULES=1 ./deploy.sh
```

After route changes, run `npm run docs:generate` in `functions/` and commit updated `postman-collection.json` files.

### Firestore & Storage rules

**Canonical** Firestore rules and indexes live under **`../frontend/`**. The backend Firebase project keeps copies **inside** `backend/` (Firebase CLI cannot reference paths outside the project directory). **`deploy.sh` runs `npm run sync:firestore` before deploy** so backend copies match frontend.

| Asset | Canonical (edit) | Backend (emulators + deploy) |
|-------|------------------|------------------------------|
| Firestore rules | `../frontend/firestore.rules` | `firestore.rules` (synced) |
| Firestore indexes | `../frontend/firestore.indexes.json` | `firestore.indexes.json` (synced) |
| Storage rules (emulator) | — | `storage.rules` (permissive — local tests only) |
| Storage rules (production) | `../frontend/storage.rules` | Optional: `DEPLOY_STORAGE_RULES=1 ./deploy.sh` after Storage is enabled |

After changing rules in frontend, sync before emulators or deploy:

```bash
npm run sync:firestore
```

`test:bdd:local`, `emulators:start`, and **`deploy.sh`** run sync automatically.

Firestore-only deploy (without functions):

```bash
npm run sync:firestore
firebase deploy --only firestore:rules,firestore:indexes --project aquaflow-management-suite
```
