import * as dotenv from "dotenv";
import { isDeployedCloudRuntime } from "../utils/smartrefill-env-mode";

/** Load `functions/.env` for emulator and local runs only — never on Cloud Run. */
export function loadLocalEnvIfNeeded(): void {
  if (isDeployedCloudRuntime()) return;
  dotenv.config();
}
