import express from "express";
import {
  listPaymentInfo,
  addPaymentInfo,
  updatePaymentInfo,
  deletePaymentInfo,
} from "../handlers/payment-handler";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";

const router = express.Router(); // eslint-disable-line new-cap

router.get("/:businessId", validateFirebaseIdToken, listPaymentInfo);
router.post("/:businessId", validateFirebaseIdToken, addPaymentInfo);
router.put(
  "/:businessId/:paymentId",
  validateFirebaseIdToken,
  updatePaymentInfo,
);
router.delete("/:businessId", validateFirebaseIdToken, deletePaymentInfo);

export default router;
