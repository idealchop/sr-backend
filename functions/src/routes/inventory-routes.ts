import express from "express";
import {
  listInventory,
  getInventoryItem,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  adjustStock,
  getCustomerAssignments,
  getItemAssignments,
  getItemStockHistory,
  assignToHub,
  returnFromHub,
} from "../handlers/inventory-handler";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";

const router = express.Router(); // eslint-disable-line new-cap

router.get("/:businessId", validateFirebaseIdToken, listInventory);
router.get("/:businessId/:itemId", validateFirebaseIdToken, getInventoryItem);
router.post("/:businessId", validateFirebaseIdToken, createInventoryItem);
router.patch(
  "/:businessId/:itemId",
  validateFirebaseIdToken,
  updateInventoryItem,
);
router.delete(
  "/:businessId/:itemId",
  validateFirebaseIdToken,
  deleteInventoryItem,
);
router.post(
  "/:businessId/:itemId/adjust-stock",
  validateFirebaseIdToken,
  adjustStock,
);
router.get(
  "/:businessId/customer/:customerId/assignments",
  validateFirebaseIdToken,
  getCustomerAssignments,
);
router.get(
  "/:businessId/:itemId/assignments",
  validateFirebaseIdToken,
  getItemAssignments,
);
router.get(
  "/:businessId/:itemId/stock-history",
  validateFirebaseIdToken,
  getItemStockHistory,
);
router.post(
  "/:businessId/:itemId/assign-to-hub",
  validateFirebaseIdToken,
  assignToHub,
);
router.post(
  "/:businessId/:itemId/return-from-hub",
  validateFirebaseIdToken,
  returnFromHub,
);

export default router;
