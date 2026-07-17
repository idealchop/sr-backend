import express from "express";
import {
  getAnalyticsDailySum,
  getBusinessAnalyticsSummary,
  getCohortStatsAnalytics,
  getDashboardAnalyticsSnapshot,
  getDebtAgingAnalytics,
  getDormantCustomersAnalytics,
  getRevenueTrendAnalytics,
  postAnalyticsMaterialize,
} from "../handlers/analytics-handler";

const router = express.Router({ mergeParams: true }); // eslint-disable-line new-cap

router.get("/", getBusinessAnalyticsSummary);
router.get("/dormant-customers", getDormantCustomersAnalytics);
router.get("/debt-aging", getDebtAgingAnalytics);
router.get("/cohort-stats", getCohortStatsAnalytics);
router.get("/revenue-trend", getRevenueTrendAnalytics);
router.get("/dashboard-snapshot", getDashboardAnalyticsSnapshot);
router.get("/daily-sum", getAnalyticsDailySum);
router.post("/materialize", postAnalyticsMaterialize);

export default router;
