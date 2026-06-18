import express from "express";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";
import {
  validateBusinessAccess,
  requireBusinessOwner,
} from "../middleware/business-middleware";
import {
  getScaleRollup,
  postScaleClone,
  getAccountantExport,
  listStaffCertifications,
  createStaffCertification,
  completeStaffCertification,
  deleteStaffCertification,
  listPartnerWebhooks,
  registerPartnerWebhook,
  getRegionalBenchmarkHandler,
  patchRegionalBenchmarkOptIn,
} from "../handlers/scale-handler";

const router = express.Router({ mergeParams: true }); // eslint-disable-line new-cap

router.get(
  "/rollup",
  validateFirebaseIdToken,
  requireBusinessOwner,
  getScaleRollup,
);

router.post(
  "/clone",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  postScaleClone,
);

router.get(
  "/accountant-export",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  getAccountantExport,
);

router.get(
  "/staff-certifications",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  listStaffCertifications,
);
router.post(
  "/staff-certifications",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  createStaffCertification,
);
router.patch(
  "/staff-certifications/:certId/complete",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  completeStaffCertification,
);
router.delete(
  "/staff-certifications/:certId",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  deleteStaffCertification,
);

router.get(
  "/webhooks",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  listPartnerWebhooks,
);
router.post(
  "/webhooks",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  registerPartnerWebhook,
);

router.get(
  "/regional-benchmark",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  getRegionalBenchmarkHandler,
);
router.patch(
  "/regional-benchmark/opt-in",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  patchRegionalBenchmarkOptIn,
);

export default router;
