import express from "express";
import {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
} from "../handlers/product-handler";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";

const router = express.Router(); // eslint-disable-line new-cap

router.get("/:businessId", validateFirebaseIdToken, listProducts);
router.get("/:businessId/:productId", validateFirebaseIdToken, getProduct);
router.post("/:businessId", validateFirebaseIdToken, createProduct);
router.patch("/:businessId/:productId", validateFirebaseIdToken, updateProduct);
router.delete("/:businessId/:productId", validateFirebaseIdToken, deleteProduct);

export default router;
