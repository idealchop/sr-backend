/**
 * Simulate Meta community Messenger webhooks against local emulator or serve:local.
 *
 * Usage (emulator must already be running):
 *   cd backend/functions && npm run community:messenger:simulate
 *   npm run community:messenger:simulate -- --action hello
 *   npm run community:messenger:simulate -- --action order
 */
import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import * as dotenv from "dotenv";
import { buildMetaWebhookSignature } from "../services/meta/meta-community-webhook-signature";

dotenv.config();

const DEFAULT_PSID = "local-test-psid-001";
const DEFAULT_PAGE_ID = "local-test-page";
const DEFAULT_API_BASE =
  "http://127.0.0.1:5001/aquaflow-management-suite/asia-southeast1/smartrefillV3Api";

const SAMPLE_ORDER = `name: Justfer (Local Test)
qty: 10
preferred water type: alkaline
location: Alabang, Muntinlupa City
email: local-test@example.com
number: 09773907598`;

type SimulateAction = "hello" | "order";

function buildLocationPinPayload(params: {
  psid: string;
  pageId: string;
  mid: string;
  latitude: number;
  longitude: number;
}): Record<string, unknown> {
  return {
    object: "page",
    entry: [{
      id: params.pageId,
      messaging: [{
        sender: { id: params.psid },
        recipient: { id: params.pageId },
        message: {
          mid: params.mid,
          attachments: [{
            type: "location",
            payload: {
              coordinates: { lat: params.latitude, long: params.longitude },
            },
          }],
        },
      }],
    }],
  };
}

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1]?.trim() || undefined;
}

function webhookUrl(): string {
  const base = (process.env.COMMUNITY_LOCAL_API_BASE ?? DEFAULT_API_BASE).replace(/\/$/, "");
  return `${base}/public/webhooks/meta/community`;
}

function buildPayload(params: {
  psid: string;
  pageId: string;
  mid: string;
  text?: string;
  postback?: string;
}): Record<string, unknown> {
  const messaging: Record<string, unknown> = {
    sender: { id: params.psid },
    recipient: { id: params.pageId },
  };

  if (params.postback) {
    messaging.postback = { payload: params.postback, title: params.postback };
  } else {
    messaging.message = { mid: params.mid, text: params.text ?? "" };
  }

  return {
    object: "page",
    entry: [{ id: params.pageId, messaging: [messaging] }],
  };
}

async function postWebhook(body: Record<string, unknown>): Promise<void> {
  const url = webhookUrl();
  const rawBody = JSON.stringify(body);
  console.log(`POST ${url}`);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const appSecret = process.env.META_COMMUNITY_APP_SECRET?.trim();
  if (appSecret) {
    headers["X-Hub-Signature-256"] = buildMetaWebhookSignature(rawBody, appSecret);
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: rawBody,
  });

  const text = await response.text();
  console.log(`→ ${response.status} ${text || "(empty body)"}`);

  if (!response.ok) {
    throw new Error(`Webhook failed: ${response.status}`);
  }

  // Handler acks immediately; give async intake a moment to finish.
  await new Promise((resolve) => setTimeout(resolve, 2500));
}

function initFirestoreAdmin(): FirebaseFirestore.Firestore {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: "aquaflow-management-suite" });
  }
  return getFirestore(admin.app(), "riverdb");
}

async function printLatestDispatchState(psid: string): Promise<void> {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    console.log("\n(Set FIRESTORE_EMULATOR_HOST to print Firestore state after simulate.)");
    return;
  }

  const db = initFirestoreAdmin();
  const snap = await db
    .collection("community_dispatch_requests")
    .where("metaPsid", "==", psid)
    .limit(5)
    .get();

  if (snap.empty) {
    console.log("\nNo community_dispatch_requests found for this PSID yet.");
    return;
  }

  type DispatchRow = {
    id: string;
    updatedAt?: unknown;
    referenceId?: string;
    status?: string;
    routingMode?: string;
  };

  const docs: DispatchRow[] = snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() } as DispatchRow))
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));

  const latest = docs[0];
  if (!latest) return;
  console.log("\nLatest dispatch request:");
  console.log(`  id:        ${latest.id}`);
  console.log(`  reference: ${latest.referenceId ?? "(pending)"}`);
  console.log(`  status:    ${latest.status ?? "(unknown)"}`);
  console.log(`  routing:   ${latest.routingMode ?? "(unknown)"}`);

  const offers = await db
    .collection("dispatch_offers")
    .where("requestId", "==", latest.id)
    .get();

  if (!offers.empty) {
    console.log("\nOffers:");
    for (const offer of offers.docs) {
      const row = offer.data();
      console.log(`  • ${offer.id} — ${row.businessId} — ${row.status}`);
    }
  }

  console.log("\nEmulator UI: http://127.0.0.1:4000/firestore");
}

async function main(): Promise<void> {
  const action = (readArg("--action") ?? "order") as SimulateAction;
  const psid = readArg("--psid") ?? DEFAULT_PSID;
  const pageId = readArg("--page-id") ?? DEFAULT_PAGE_ID;
  const mid = `m-local-${Date.now()}`;

  if (action === "hello") {
    await postWebhook(buildPayload({ psid, pageId, mid, text: "hello" }));
  } else if (action === "order") {
    await postWebhook(buildPayload({ psid, pageId, mid, text: SAMPLE_ORDER }));
    // Location pin near seeded test WRS — works without Google Maps API in local emulator.
    await postWebhook(
      buildLocationPinPayload({
        psid,
        pageId,
        mid: `${mid}-pin`,
        latitude: 14.42,
        longitude: 121.04,
      }),
    );
  } else {
    throw new Error(`Unknown action: ${action}`);
  }

  await printLatestDispatchState(psid);

  if (action === "order") {
    console.log("\nNext steps:");
    console.log("  1. Open http://127.0.0.1:4000/firestore → community_dispatch_requests");
    console.log("  2. Log into the app as test WRS owner and accept the community offer");
    console.log("  3. Customer receives order summary + track link in Messenger automatically");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
