import express from "express";
import {
  acceptSubmission,
  cancelSubmission,
  getSubmissionDetail,
  linkSubmissionCustomer,
  listPendingSubmissions,
  markSubmissionFulfilled,
  mergeSubmissionProfileToCustomer,
  registerNewSukiFromSubmission,
} from "../handlers/portal/raw-submission-handler";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";
import { validateBusinessAccess } from "../middleware/business-middleware";

const router = express.Router({ mergeParams: true }); // eslint-disable-line new-cap

router.get(
  "/pending",
  validateFirebaseIdToken,
  validateBusinessAccess,
  listPendingSubmissions,
);
router.get(
  "/:submissionId",
  validateFirebaseIdToken,
  validateBusinessAccess,
  getSubmissionDetail,
);
router.patch(
  "/:submissionId/link-customer",
  validateFirebaseIdToken,
  validateBusinessAccess,
  linkSubmissionCustomer,
);
router.post(
  "/:submissionId/merge-profile",
  validateFirebaseIdToken,
  validateBusinessAccess,
  mergeSubmissionProfileToCustomer,
);
router.post(
  "/:submissionId/register-new-suki",
  validateFirebaseIdToken,
  validateBusinessAccess,
  registerNewSukiFromSubmission,
);
router.post(
  "/:submissionId/accept",
  validateFirebaseIdToken,
  validateBusinessAccess,
  acceptSubmission,
);
router.post(
  "/:submissionId/cancel",
  validateFirebaseIdToken,
  validateBusinessAccess,
  cancelSubmission,
);
router.post(
  "/:submissionId/mark-fulfilled",
  validateFirebaseIdToken,
  validateBusinessAccess,
  markSubmissionFulfilled,
);

export default router;
