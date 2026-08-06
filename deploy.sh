#!/usr/bin/env bash

# SmartRefill V3 — build, test (unit + integration + community + BDD), lint, deploy.
# Deploys: v3-api functions (API + scheduled jobs + triggers), Firestore rules/indexes.
# Optional: production Storage rules when DEPLOY_STORAGE_RULES=1 (requires Firebase Storage on the project).
# BDD: seeds Firestore (riverdb) then runs Playwright against emulators.
#
# ENV=prod (default): identical to legacy — functions:v3-api + riverdb rules/indexes.
#   Also refreshes additive smartrefillV3ApiDev if present in the codebase (does not change Prod API).
# ENV=dev: deploys only smartrefillV3ApiDev (+ optional *Dev jobs) and riverdb-dev rules/indexes.
#   DEPLOY_DEV_JOBS=1 — also deploy Dev schedulers/triggers (on-demand; gated by SMARTREFILL_DEV_JOBS_ENABLED).

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FUNCTIONS_DIR="${ROOT_DIR}/functions"
FRONTEND_DIR="${ROOT_DIR}/../frontend"
PROJECT_ID="aquaflow-management-suite"
DEPLOY_ENV="${ENV:-prod}"
FIREBASE_CONFIG="${ROOT_DIR}/firebase.json"
DEV_JOBS_EXPORTS="${FUNCTIONS_DIR}/src/dev/dev-jobs-exports.ts"
DEV_JOBS_EXPORTS_ENABLED="${FUNCTIONS_DIR}/src/dev/dev-jobs-exports.enabled.ts"
DEV_JOBS_EXPORTS_BAK=""

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

if [[ "${DEPLOY_ENV}" != "prod" && "${DEPLOY_ENV}" != "dev" ]]; then
  echo -e "${RED}❌ ENV must be prod or dev (got: ${DEPLOY_ENV})${NC}"
  exit 1
fi

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if [[ "${NODE_MAJOR}" -ge 26 ]]; then
  echo -e "${RED}❌ Node $(node -v) crashed during deploy tests (Vitest + CJS on Node 26).${NC}"
  echo -e "${YELLOW}   Use Node 22 (matches Cloud Functions runtime):${NC}"
  echo -e "${YELLOW}     nvm install 22 && nvm use 22${NC}"
  echo -e "${YELLOW}   Or temporarily: nvm use 20   or   nvm use 24${NC}"
  echo -e "${YELLOW}   Then re-run: ./deploy.sh${NC}"
  exit 1
fi

echo -e "${BLUE}🚀 Starting compilation and deployment for SmartRefill V3... (Node $(node -v), ENV=${DEPLOY_ENV})${NC}"

restore_dev_jobs_exports() {
  if [[ -n "${DEV_JOBS_EXPORTS_BAK}" && -f "${DEV_JOBS_EXPORTS_BAK}" ]]; then
    mv "${DEV_JOBS_EXPORTS_BAK}" "${DEV_JOBS_EXPORTS}"
    DEV_JOBS_EXPORTS_BAK=""
  fi
}

if [[ "${DEPLOY_ENV}" == "dev" && "${DEPLOY_DEV_JOBS:-0}" == "1" ]]; then
  echo -e "${YELLOW}   Enabling Dev job exports (DEPLOY_DEV_JOBS=1)...${NC}"
  DEV_JOBS_EXPORTS_BAK="${DEV_JOBS_EXPORTS}.deploy-bak-$$"
  cp "${DEV_JOBS_EXPORTS}" "${DEV_JOBS_EXPORTS_BAK}"
  cp "${DEV_JOBS_EXPORTS_ENABLED}" "${DEV_JOBS_EXPORTS}"
fi

cd "${FUNCTIONS_DIR}"

if [[ ! -d node_modules ]]; then
  echo -e "${BLUE}📦 Installing functions dependencies...${NC}"
  npm install
fi

echo -e "${BLUE}🏗️ Compiling TypeScript...${NC}"
npm run build

echo -e "${BLUE}🧪 Running unit tests...${NC}"
npm run test:unit

echo -e "${BLUE}🔗 Running integration tests...${NC}"
npm run test:integration

echo -e "${BLUE}💬 Running community Messenger dispatch tests...${NC}"
npm run test:community

echo -e "${BLUE}🎭 Running BDD tests (Playwright + emulators)...${NC}"
cd "${ROOT_DIR}"

echo -e "${BLUE}📋 Syncing Firestore + Storage rules/indexes from frontend...${NC}"
npm run sync:firestore

SALES_PORTAL_BACKEND="${ROOT_DIR}/../../sales-portal/backend"
if [[ -f "${SALES_PORTAL_BACKEND}/package.json" ]]; then
  echo -e "${BLUE}🔎 Verifying Firestore + Storage sync with sales-portal/backend...${NC}"
  npm --prefix "${SALES_PORTAL_BACKEND}" run sync:firestore
  npm --prefix "${SALES_PORTAL_BACKEND}" run check:firestore
fi

if [[ ! -d node_modules/firebase-admin ]]; then
  echo -e "${BLUE}📦 Installing root dependencies (seed-emulator.js)...${NC}"
  npm install
fi

npx -y firebase-tools@15 emulators:exec \
  --project "${PROJECT_ID}" \
  --only "functions,firestore,auth,storage" \
  "node seed-emulator.js && cd functions && npm run test:bdd"

cd "${FUNCTIONS_DIR}"

echo -e "${BLUE}🔍 Running linter...${NC}"
npm run lint -- --fix

echo -e "${BLUE}📋 Syncing Firestore + Storage rules/indexes from frontend...${NC}"
cd "${ROOT_DIR}"
npm run sync:firestore

if [[ -f "${SALES_PORTAL_BACKEND}/package.json" ]]; then
  echo -e "${BLUE}🔎 Verifying Firestore + Storage sync with sales-portal/backend...${NC}"
  npm --prefix "${SALES_PORTAL_BACKEND}" run sync:firestore
  npm --prefix "${SALES_PORTAL_BACKEND}" run check:firestore
fi

# Plain .env keys that are also bound via Secret Manager break Cloud Functions deploy.
FUNCTIONS_ENV="${FUNCTIONS_DIR}/.env"
FUNCTIONS_ENV_DEPLOY_BAK=""
restore_functions_env() {
  if [[ -n "${FUNCTIONS_ENV_DEPLOY_BAK}" && -f "${FUNCTIONS_ENV_DEPLOY_BAK}" ]]; then
    mv "${FUNCTIONS_ENV_DEPLOY_BAK}" "${FUNCTIONS_ENV}"
    FUNCTIONS_ENV_DEPLOY_BAK=""
  fi
}
restore_all_deploy_temps() {
  restore_functions_env
  restore_dev_jobs_exports
}
if [[ -f "${FUNCTIONS_ENV}" ]] && grep -qE '^(DOCS_ADMIN_TOKEN|SMARTREFILL_BREVO_API_KEY)=' "${FUNCTIONS_ENV}"; then
  FUNCTIONS_ENV_DEPLOY_BAK="${FUNCTIONS_ENV}.deploy-bak-$$"
  echo -e "${YELLOW}   Temporarily moving functions/.env aside (Secret Manager overlap).${NC}"
  mv "${FUNCTIONS_ENV}" "${FUNCTIONS_ENV_DEPLOY_BAK}"
fi
trap restore_all_deploy_temps EXIT

if [[ "${DEPLOY_ENV}" == "dev" ]]; then
  FIREBASE_CONFIG="${ROOT_DIR}/firebase.dev.json"
  # Codebase-qualified filters (firebase-tools requires v3-api:<name>)
  DEV_ONLY="functions:v3-api:smartrefillV3ApiDev"
  if [[ "${DEPLOY_DEV_JOBS:-0}" == "1" ]]; then
    DEV_ONLY="${DEV_ONLY},functions:v3-api:purgeExpiredProactiveScheduleWeekSnapshotsDev,functions:v3-api:purgeExpiredTeamChatsDev,functions:v3-api:backfillCustomerLastFulfilledDev,functions:v3-api:reconcileAnalyticsSnapshotsDev,functions:v3-api:dormantDigestNotificationDev,functions:v3-api:morningOwnerIntelligenceDev,functions:v3-api:proactiveInsightPushNotificationDev,functions:v3-api:pmRecurrenceSchedulerDev,functions:v3-api:subscriptionAutoRenewSchedulerDev,functions:v3-api:guestWebinarRemindersDev,functions:v3-api:ownerDataWarehouseExportDev,functions:v3-api:onSubscriptionUpdatedDev"
    echo -e "${BLUE}🔥 Deploying Dev Cloud Functions (API + jobs/triggers) → riverdb-dev...${NC}"
  else
    echo -e "${BLUE}🔥 Deploying Dev Cloud Functions (API only) → riverdb-dev...${NC}"
    echo -e "${YELLOW}   Tip: DEPLOY_DEV_JOBS=1 to also deploy Dev schedulers/triggers.${NC}"
  fi
  npx -y firebase-tools@15 deploy --project "${PROJECT_ID}" \
    --config "${FIREBASE_CONFIG}" \
    --only "${DEV_ONLY},firestore:rules,firestore:indexes"
else
  echo -e "${BLUE}🔥 Deploying Cloud Functions (v3-api codebase: API, schedulers, triggers)...${NC}"
  npx -y firebase-tools@15 deploy --project "${PROJECT_ID}" \
    --only functions:v3-api,firestore:rules,firestore:indexes
fi

if [[ "${DEPLOY_ENV}" == "prod" && "${DEPLOY_STORAGE_RULES:-0}" == "1" ]]; then
  echo -e "${BLUE}🔥 Deploying production Storage rules...${NC}"
  cd "${FRONTEND_DIR}"
  set +e
  npx -y firebase-tools@15 deploy --project "${PROJECT_ID}" --only storage
  STORAGE_DEPLOY_EXIT=$?
  set -e
  cd "${ROOT_DIR}"
  if [[ "${STORAGE_DEPLOY_EXIT}" -ne 0 ]]; then
    echo -e "${BLUE}⚠️  Storage rules were not deployed.${NC}"
    echo -e "${BLUE}   Enable Firebase Storage for ${PROJECT_ID} first:${NC}"
    echo -e "${BLUE}   https://console.firebase.google.com/project/${PROJECT_ID}/storage${NC}"
    exit "${STORAGE_DEPLOY_EXIT}"
  fi
elif [[ "${DEPLOY_ENV}" == "prod" ]]; then
  echo -e "${BLUE}ℹ️  Skipping Storage rules (not enabled on ${PROJECT_ID}).${NC}"
  echo -e "${BLUE}   Uploads use the API; set DEPLOY_STORAGE_RULES=1 after enabling Storage.${NC}"
fi

echo -e "${GREEN}✅ Deployment successful!${NC}"
if [[ "${DEPLOY_ENV}" == "dev" ]]; then
  echo -e "${GREEN}   • smartrefillV3ApiDev → riverdb-dev${NC}"
  if [[ "${DEPLOY_DEV_JOBS:-0}" == "1" ]]; then
    echo -e "${GREEN}   • Dev schedulers/triggers (SMARTREFILL_DEV_JOBS_ENABLED=true)${NC}"
  fi
  echo -e "${GREEN}   • firestore:rules, firestore:indexes (riverdb-dev)${NC}"
else
  echo -e "${GREEN}   • functions:v3-api (smartrefillV3Api, purgeExpiredTeamChats, purgeExpiredProactiveScheduleWeekSnapshots, onSubscriptionUpdated)${NC}"
  echo -e "${GREEN}   • firestore:rules, firestore:indexes (riverdb)${NC}"
  if [[ "${DEPLOY_STORAGE_RULES:-0}" == "1" ]]; then
    echo -e "${GREEN}   • storage rules (production)${NC}"
  fi
fi
