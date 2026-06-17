import express from "express";
import { riderCashRemittanceHandler } from "../handlers/riders/rider-cash-remittance-handler";

const router = express.Router({ mergeParams: true }); // eslint-disable-line new-cap

router.get("/", riderCashRemittanceHandler.listByDate);

export default router;
