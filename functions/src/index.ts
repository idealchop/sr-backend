import { onRequest } from "firebase-functions/v2/https";
import express from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { rateLimitKeyForRequest } from "./config/rate-limit-keys";

// Routes
import authRoutes from "./routes/auth-routes";
import businessRoutes from "./routes/business-routes";
import onboardingRoutes from "./routes/onboarding-routes";
import notificationRoutes from "./routes/notification-routes";
import auditRoutes from "./routes/audit-routes";
import paymentRoutes from "./routes/payment-routes";
import subscriptionRoutes from "./routes/subscription-routes";
import inventoryRoutes from "./routes/inventory-routes";
import productionShiftRoutes from "./routes/production-shift-routes";
import maintenanceTemplateRoutes from "./routes/maintenance-template-routes";
import waterQualityLogRoutes from "./routes/water-quality-log-routes";
import plantOpsRoutes from "./routes/plant-ops-routes";
import fileRoutes from "./routes/file-routes";
import publicRoutes from "./routes/public-routes";
import platformRoutes from "./routes/platform-routes";

// Swagger API Documentation
import swaggerUi from "swagger-ui-express";
import { openApiSpec } from "./docs/openapi";
import { validateDocsAdminToken } from "./middleware/docs-auth-middleware";

const app = express();

// Trust proxy for Cloud Run / Load Balancer
app.set("trust proxy", 1);

// Middleware
app.use(cors({ origin: true }));
// Capture raw body for Meta webhook signature verification (CP-27).
app.use(express.json({
  limit: "2mb",
  verify: (req, _res, buf) => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
  },
}));

// Global Rate Limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 3000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: rateLimitKeyForRequest,
  skip: (req) => req.method === "OPTIONS" || !!process.env.FUNCTIONS_EMULATOR,
  message: "Too many requests, please try again after 15 minutes",
});

app.use(globalLimiter);

// Domain Routers
app.use("/auth", authRoutes);
app.use("/business", businessRoutes);
app.use("/onboarding", onboardingRoutes);
app.use("/notifications", notificationRoutes);
app.use("/audit", auditRoutes);
app.use("/business/payment-info", paymentRoutes);
app.use("/subscriptions", subscriptionRoutes);
app.use("/inventory", inventoryRoutes);
app.use("/plant/production-shifts", productionShiftRoutes);
app.use("/plant/maintenance-templates", maintenanceTemplateRoutes);
app.use("/plant/water-quality", waterQualityLogRoutes);
app.use("/plant", plantOpsRoutes);
app.use("/files", fileRoutes);
app.use("/public", publicRoutes);
app.use("/platform", platformRoutes);

// Secured Interactive Swagger UI
app.use("/docs", validateDocsAdminToken, swaggerUi.serve, swaggerUi.setup(openApiSpec));
app.get("/docs.json", validateDocsAdminToken, (req, res) => {
  res.json(openApiSpec);
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", emulator: !!process.env.FUNCTIONS_EMULATOR });
});

const api = express();
api.use("/", app);

// Brevo: production reads SMARTREFILL_BREVO_API_KEY from Secret Manager via `secrets` below.
// Local: SMARTREFILL_ENV_DEV=true + keys and APP_BASE_URL in functions/.env — never set
// SMARTREFILL_ENV_DEV on deployed functions (prod links always use https://app.smartrefill.io).

// Export the API Gateway
export { app };
export const smartrefillV3Api = onRequest(
  {
    region: "asia-southeast1",
    cors: true,
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

export { purgeExpiredProactiveScheduleWeekSnapshots } from
  "./jobs/purge-proactive-schedule-snapshots";
export { purgeExpiredTeamChats } from "./jobs/purge-expired-team-chats";
export { backfillCustomerLastFulfilled } from "./jobs/backfill-customer-last-fulfilled";
export { dormantDigestNotification } from "./jobs/dormant-digest-notification";
export { morningOwnerIntelligence } from "./jobs/morning-owner-intelligence";
export { proactiveInsightPushNotification } from "./jobs/proactive-insight-push-notification";
export { pmRecurrenceScheduler } from "./jobs/pm-recurrence-scheduler";
export { subscriptionAutoRenewScheduler } from "./jobs/subscription-auto-renew-scheduler";
export { communityDispatchExpireOffers } from "./jobs/community-dispatch-expire-offers";
export { ownerDataWarehouseExport } from "./jobs/owner-data-warehouse-export";
export { onSubscriptionUpdated } from "./triggers/subscription-triggers";
