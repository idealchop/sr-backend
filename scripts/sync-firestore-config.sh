#!/usr/bin/env bash
# Copy canonical Firestore + Storage rules from frontend → backend (for emulators + deploy).
# Canonical source: smartrefill/frontend/firestore.rules, firestore.indexes.json, storage.rules
# (SmartRefill V3 + Sales Portal — keep sales-portal/backend in sync via its sync:firestore script)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND="$(cd "$ROOT/../frontend" && pwd)"
cp "$FRONTEND/firestore.rules" "$ROOT/firestore.rules"
cp "$FRONTEND/firestore.indexes.json" "$ROOT/firestore.indexes.json"
cp "$FRONTEND/storage.rules" "$ROOT/storage.rules"
echo "Synced Firestore + Storage config from frontend/ to backend/"
