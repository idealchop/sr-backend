import { onRequest } from "firebase-functions/v2/https";
import { api } from "../index-api";

/**
 * Dev HTTP gateway — same Express app as Prod.
 * Uses riverdb-dev via function-name Dev-tier detection (see config/dev-tier.ts).
 * Does not replace smartrefillV3Api.
 */
export const smartrefillV3ApiDev = onRequest(
  {
    region: "asia-southeast1",
    cors: true,
    memory: "1GiB",
    timeoutSeconds: 120,
    secrets: [
      "DOCS_ADMIN_TOKEN",
      "SMARTREFILL_BREVO_API_KEY",
      "GEMINI_API_KEY",
      "SMARTREFILL_GOOGLE_MAPS_SERVER_API_KEY",
      "smartrefill-firebase-google-maps-api-key",
      "META_COMMUNITY_VERIFY_TOKEN",
      "META_COMMUNITY_PAGE_ACCESS_TOKEN",
      "META_COMMUNITY_PAGE_ID",
      "META_COMMUNITY_APP_SECRET",
      "PAYMONGO_SECRET_KEY",
      "PAYMONGO_WEBHOOK_SECRET",
    ],
  },
  api,
);
