#!/usr/bin/env bash

# SmartRefill V3 — build, test (unit + integration + community + BDD), lint, deploy.
# Deploys: v3-api functions (API + scheduled jobs + triggers), Firestore rules/indexes.
# Optional: production Storage rules when DEPLOY_STORAGE_RULES=1 (requires Firebase Storage on the project).
# BDD: seeds Firestore (riverdb) then runs Playwright against emulators.

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FUNCTIONS_DIR="${ROOT_DIR}/functions"
FRONTEND_DIR="${ROOT_DIR}/../frontend"
PROJECT_ID="aquaflow-management-suite"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if [[ "${NODE_MAJOR}" -ge 26 ]]; then
  echo -e "${RED}❌ Node $(node -v) crashed during deploy tests (Vitest + CJS on Node 26).${NC}"
  echo -e "${YELLOW}   Use Node 22 (matches Cloud Functions runtime):${NC}"
  echo -e "${YELLOW}     nvm install 22 && nvm use 22${NC}"
  echo -e "${YELLOW}   Or temporarily: nvm use 20   or   nvm use 24${NC}"
  echo -e "${YELLOW}   Then re-run: ./deploy.sh${NC}"
  exit 1
fi

echo -e "${BLUE}🚀 Starting compilation and deployment for SmartRefill V3... (Node $(node -v))${NC}"

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
if [[ -f "${FUNCTIONS_ENV}" ]] && grep -qE '^(DOCS_ADMIN_TOKEN|SMARTREFILL_BREVO_API_KEY)=' "${FUNCTIONS_ENV}"; then
  FUNCTIONS_ENV_DEPLOY_BAK="${FUNCTIONS_ENV}.deploy-bak-$$"
  echo -e "${YELLOW}   Temporarily moving functions/.env aside (Secret Manager overlap).${NC}"
  mv "${FUNCTIONS_ENV}" "${FUNCTIONS_ENV_DEPLOY_BAK}"
fi
trap restore_functions_env EXIT

echo -e "${BLUE}🔥 Deploying Cloud Functions (v3-api codebase: API, schedulers, triggers)...${NC}"
npx -y firebase-tools@15 deploy --project "${PROJECT_ID}" \
  --only functions:v3-api,firestore:rules,firestore:indexes

if [[ "${DEPLOY_STORAGE_RULES:-0}" == "1" ]]; then
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
else
  echo -e "${BLUE}ℹ️  Skipping Storage rules (not enabled on ${PROJECT_ID}).${NC}"
  echo -e "${BLUE}   Uploads use the API; set DEPLOY_STORAGE_RULES=1 after enabling Storage.${NC}"
fi

echo -e "${GREEN}✅ Deployment successful!${NC}"
echo -e "${GREEN}   • functions:v3-api (smartrefillV3Api, purgeExpiredTeamChats, purgeExpiredProactiveScheduleWeekSnapshots, onSubscriptionUpdated)${NC}"
echo -e "${GREEN}   • firestore:rules, firestore:indexes (riverdb)${NC}"
if [[ "${DEPLOY_STORAGE_RULES:-0}" == "1" ]]; then
  echo -e "${GREEN}   • storage rules (production)${NC}"
fi
