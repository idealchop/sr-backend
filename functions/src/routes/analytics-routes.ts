import express from "express";
import {
  getBusinessAnalyticsSummary,
  getCohortStatsAnalytics,
  getDebtAgingAnalytics,
  getDormantCustomersAnalytics,
  getRevenueTrendAnalytics,
} from "../handlers/analytics-handler";

const router = express.Router(); // eslint-disable-line new-cap

router.get("/", getBusinessAnalyticsSummary);
router.get("/dormant-customers", getDormantCustomersAnalytics);
router.get("/debt-aging", getDebtAgingAnalytics);
router.get("/cohort-stats", getCohortStatsAnalytics);
router.get("/revenue-trend", getRevenueTrendAnalytics);

export default router;
