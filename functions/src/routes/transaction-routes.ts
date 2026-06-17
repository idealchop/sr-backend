import express from "express";
import { transactionHandler } from "../handlers/transactions/transaction-handler";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";
import { validateBusinessAccess } from "../middleware/business-middleware";

const router = express.Router({ mergeParams: true }); // eslint-disable-line new-cap

// Mounted at /businesses/:businessId/transactions
router.get(
  "/",
  validateFirebaseIdToken,
  validateBusinessAccess,
  transactionHandler.listTransactions,
);
router.post(
  "/:id/claim-nearby-stop",
  validateFirebaseIdToken,
  validateBusinessAccess,
  transactionHandler.claimNearbyStop,
);
router.get(
  "/:id",
  validateFirebaseIdToken,
  validateBusinessAccess,
  transactionHandler.getTransaction,
);
router.get(
  "/:id/history",
  validateFirebaseIdToken,
  validateBusinessAccess,
  transactionHandler.getTransactionHistory,
);
router.post(
  "/",
  validateFirebaseIdToken,
  validateBusinessAccess,
  transactionHandler.createTransaction,
);
router.patch(
  "/:id",
  validateFirebaseIdToken,
  validateBusinessAccess,
  transactionHandler.updateTransaction,
);
router.delete(
  "/:id",
  validateFirebaseIdToken,
  validateBusinessAccess,
  transactionHandler.deleteTransaction,
);

export default router;
