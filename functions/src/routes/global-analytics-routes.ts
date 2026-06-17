import express from "express";
import { getMultiStationBenchmark } from "../handlers/analytics-handler";

const router = express.Router(); // eslint-disable-line new-cap

router.get("/multi-station-benchmark", getMultiStationBenchmark);

export default router;
