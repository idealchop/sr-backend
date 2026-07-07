import express from "express";
import {
  listPlans,
  getSubscriptionStatus,
  renewSubscription,
  upgradeSubscription,
  downgradeSubscription,
  cancelSubscription,
  resumeSubscription,
  listSubscriptionHistory,
  downloadSubscriptionHistoryInvoicePdf,
  listCatalogAddons,
  validateCheckoutVoucher,
  seedSubscriptionCatalog,
  resetSubscriptionTrialForBdd,
  pauseTrialSubscription,
} from "../handlers/subscription-handler";
import { postSubscriptionPaymentIntent } from "../handlers/payments/payment-intent-handler";
import {
  getSubscriptionBilling,
  postSubscriptionBillingLink,
} from "../handlers/subscription-billing-handler";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";

const router = express.Router(); // eslint-disable-line new-cap

router.get("/catalog/addons", validateFirebaseIdToken, listCatalogAddons);
router.post(
  "/dev/seed-catalog",
  validateFirebaseIdToken,
  seedSubscriptionCatalog,
);
router.post(
  "/:businessId/dev/reset-trial",
  validateFirebaseIdToken,
  resetSubscriptionTrialForBdd,
);
router.get("/plans", validateFirebaseIdToken, listPlans);
router.post(
  "/:businessId/vouchers/validate",
  validateFirebaseIdToken,
  validateCheckoutVoucher,
);
router.post(
  "/:businessId/payment-intent",
  validateFirebaseIdToken,
  postSubscriptionPaymentIntent,
);
router.get(
  "/:businessId/billing",
  validateFirebaseIdToken,
  getSubscriptionBilling,
);
router.post(
  "/:businessId/billing/link",
  validateFirebaseIdToken,
  postSubscriptionBillingLink,
);
router.get(
  "/:businessId/status",
  validateFirebaseIdToken,
  getSubscriptionStatus,
);
router.post("/:businessId/renew", validateFirebaseIdToken, renewSubscription);
router.post(
  "/:businessId/upgrade",
  validateFirebaseIdToken,
  upgradeSubscription,
);
router.post(
  "/:businessId/downgrade",
  validateFirebaseIdToken,
  downgradeSubscription,
);
router.post("/:businessId/cancel", validateFirebaseIdToken, cancelSubscription);
router.post("/:businessId/resume", validateFirebaseIdToken, resumeSubscription);
router.post(
  "/:businessId/trial/pause",
  validateFirebaseIdToken,
  pauseTrialSubscription,
);
router.get(
  "/:businessId/history/:subscriptionId/invoice-pdf",
  validateFirebaseIdToken,
  downloadSubscriptionHistoryInvoicePdf,
);
router.get(
  "/:businessId/history",
  validateFirebaseIdToken,
  listSubscriptionHistory,
);

export default router;
