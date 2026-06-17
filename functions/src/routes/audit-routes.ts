import express from "express";
import { validateFirebaseIdToken } from "../middleware/auth-middleware";
import { listBusinessAuditLogs } from "../handlers/audit-handler";

const router = express.Router(); // eslint-disable-line new-cap

// All audit routes require authentication
router.use(validateFirebaseIdToken);

router.get("/business/:businessId", listBusinessAuditLogs);

export default router;
