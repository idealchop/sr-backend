import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../middleware/auth-middleware", () => ({
  validateAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { user: { uid: string } }).user = { uid: "user-1" };
    next();
  },
}));

vi.mock("../../../middleware/business-access", () => ({
  validateBusinessAccess: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => next(),
}));

vi.mock("../../../handlers/analytics-handler", () => ({
  getBusinessAnalyticsSummary: (req: express.Request, res: express.Response) =>
    res.json({ route: "summary", businessId: req.params.businessId }),
  getDormantCustomersAnalytics: (req: express.Request, res: express.Response) =>
    res.json({ route: "dormant-customers", businessId: req.params.businessId }),
  getDebtAgingAnalytics: (req: express.Request, res: express.Response) =>
    res.json({ route: "debt-aging", businessId: req.params.businessId }),
  getCohortStatsAnalytics: (req: express.Request, res: express.Response) =>
    res.json({ route: "cohort-stats", businessId: req.params.businessId }),
  getRevenueTrendAnalytics: (req: express.Request, res: express.Response) =>
    res.json({ route: "revenue-trend", businessId: req.params.businessId }),
}));

import analyticsRoutes from "../../../routes/analytics-routes";

function mountAnalyticsRoutes() {
  const app = express();
  const businessRouter = express.Router({ mergeParams: true }); // eslint-disable-line new-cap
  businessRouter.use("/:businessId/analytics", analyticsRoutes);
  app.use("/business", businessRouter);
  return app;
}

describe("analytics-routes", () => {
  it("inherits businessId from parent mount (mergeParams)", async () => {
    const app = mountAnalyticsRoutes();
    const businessId = "PcH6UKjFxeeb9DnkYK9260c76dL2";

    const endpoints = [
      "/dormant-customers",
      "/debt-aging",
      "/cohort-stats",
      "/revenue-trend",
    ] as const;

    for (const endpoint of endpoints) {
      const res = await request(app).get(`/business/${businessId}/analytics${endpoint}`);
      expect(res.status).toBe(200);
      expect(res.body.businessId).toBe(businessId);
    }
  });
});
