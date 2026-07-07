import express from "express";
import {
  listCustomers,
  getCustomer,
  getCustomerStats,
  addCustomer,
  updateCustomer,
  deleteCustomer,
  getSingleCustomerStats,
  claimNearbyDormantCustomer,
} from "../handlers/customer-handler";
import { acceptContainerCustodyAgreement } from "../handlers/customers/container-custody-handler";
import { statementShareHandler } from "../handlers/customers/statement-share-handler";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";
import { validateBusinessAccess } from "../middleware/business-middleware";

const router = express.Router({ mergeParams: true }); // eslint-disable-line new-cap

// Mounted at /businesses/:businessId/customers
router.get("/", validateFirebaseIdToken, validateBusinessAccess, listCustomers);
router.get(
  "/stats",
  validateFirebaseIdToken,
  validateBusinessAccess,
  getCustomerStats,
);
router.post(
  "/statement-share",
  validateFirebaseIdToken,
  validateBusinessAccess,
  statementShareHandler.createStatementShare,
);
router.get(
  "/:customerId/stats",
  validateFirebaseIdToken,
  validateBusinessAccess,
  getSingleCustomerStats,
);
router.get(
  "/:customerId",
  validateFirebaseIdToken,
  validateBusinessAccess,
  getCustomer,
);
router.post("/", validateFirebaseIdToken, validateBusinessAccess, addCustomer);
router.patch(
  "/:customerId",
  validateFirebaseIdToken,
  validateBusinessAccess,
  updateCustomer,
);
router.post(
  "/:customerId/container-custody-agreement/accept",
  validateFirebaseIdToken,
  validateBusinessAccess,
  acceptContainerCustodyAgreement,
);
router.post(
  "/:customerId/claim-nearby-dormant",
  validateFirebaseIdToken,
  validateBusinessAccess,
  claimNearbyDormantCustomer,
);
router.delete(
  "/:customerId",
  validateFirebaseIdToken,
  validateBusinessAccess,
  deleteCustomer,
);

export default router;
