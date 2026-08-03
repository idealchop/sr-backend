import express from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { rateLimitKeyForRequest } from "./config/rate-limit-keys";

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
import eventsTrainingRoutes from "./routes/events-training-routes";

import swaggerUi from "swagger-ui-express";
import { openApiSpec } from "./docs/openapi";
import { validateDocsAdminToken } from "./middleware/docs-auth-middleware";

const app = express();

app.set("trust proxy", 1);

app.use(cors({ origin: true }));
app.use(express.json({
  limit: "2mb",
  verify: (req, _res, buf) => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
  },
}));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: rateLimitKeyForRequest,
  skip: (req) => req.method === "OPTIONS" || !!process.env.FUNCTIONS_EMULATOR,
  message: "Too many requests, please try again after 15 minutes",
});

app.use(globalLimiter);

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
app.use("/events-training", eventsTrainingRoutes);

app.use("/docs", validateDocsAdminToken, swaggerUi.serve, swaggerUi.setup(openApiSpec));
app.get("/docs.json", validateDocsAdminToken, (req, res) => {
  res.json(openApiSpec);
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", emulator: !!process.env.FUNCTIONS_EMULATOR });
});

const api = express();
api.use("/", app);

export { app, api };
