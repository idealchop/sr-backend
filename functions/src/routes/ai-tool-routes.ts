import express from "express";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";
import {
  validateBusinessAccess,
  requireBusinessOwner,
} from "../middleware/business-middleware";
import { createAiToolRun, listAiToolRuns } from "../handlers/ai-tool-handler";
import { postParseOrderText } from "../handlers/order-parse-handler";
import { postDashboardQa } from "../handlers/ai-dashboard-qa-handler";
import { postRunWorkflow } from "../handlers/ai-workflow-handler";
import {
  postDuplicatesDetect,
  postDuplicatesMerge,
  postInventoryScanApply,
  postInventoryScanImage,
  postInventoryScanText,
  postLedgerScanCommit,
  postLedgerScanImage,
  postLedgerScanText,
} from "../handlers/river-capabilities-handler";
import {
  getCustomerImportAiEligibility,
  postCustomerImportAiCommit,
  postCustomerImportAiParse,
  postCustomerImportAiProfile,
} from "../handlers/customer-import-ai-handler"; import {
  getCustomerHistoryImportAiEligibility,
  postCustomerHistoryImportAiCommit,
  postCustomerHistoryImportAiParse,
  postCustomerHistoryImportAiProfile,
} from "../handlers/customer-history-import-ai-handler";
import {
  getInventoryImportAiEligibility,
  postInventoryImportAiCommit,
  postInventoryImportAiParse,
  postInventoryImportAiProfile,
} from "../handlers/inventory-import-ai-handler";

const router = express.Router({ mergeParams: true }); // eslint-disable-line new-cap

router.get(
  "/runs",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  listAiToolRuns,
);
router.post(
  "/runs",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  createAiToolRun,
);

router.post(
  "/parse-order",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  postParseOrderText,
);

router.post(
  "/dashboard-qa",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  postDashboardQa,
);

router.post(
  "/run-workflow",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  postRunWorkflow,
);

router.post(
  "/ledger-scan/text",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  postLedgerScanText,
);
router.post(
  "/ledger-scan/image",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  postLedgerScanImage,
);
router.post(
  "/ledger-scan/commit",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  postLedgerScanCommit,
);

router.post(
  "/duplicates/detect",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  postDuplicatesDetect,
);
router.post(
  "/duplicates/merge",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  postDuplicatesMerge,
);

router.post(
  "/inventory-scan/text",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  postInventoryScanText,
);
router.post(
  "/inventory-scan/image",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  postInventoryScanImage,
);
router.post(
  "/inventory-scan/apply",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  postInventoryScanApply,
);

router.get(
  "/customer-import/eligibility",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  getCustomerImportAiEligibility,
);
router.post(
  "/customer-import/parse",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  postCustomerImportAiParse,
);
router.post(
  "/customer-import/profile",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  postCustomerImportAiProfile,
);
router.post(
  "/customer-import/commit",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  postCustomerImportAiCommit,
);

router.get(
  "/customer-history-import/:customerId/eligibility",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  getCustomerHistoryImportAiEligibility,
);
router.post(
  "/customer-history-import/:customerId/parse",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  postCustomerHistoryImportAiParse,
);
router.post(
  "/customer-history-import/:customerId/profile",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  postCustomerHistoryImportAiProfile,
);
router.post(
  "/customer-history-import/:customerId/commit",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  postCustomerHistoryImportAiCommit,
);

router.get(
  "/inventory-import/eligibility",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  getInventoryImportAiEligibility,
);
router.post(
  "/inventory-import/parse",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  postInventoryImportAiParse,
);
router.post(
  "/inventory-import/profile",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  postInventoryImportAiProfile,
);
router.post(
  "/inventory-import/commit",
  validateFirebaseIdToken,
  validateBusinessAccess,
  requireBusinessOwner,
  postInventoryImportAiCommit,
);

export default router;
