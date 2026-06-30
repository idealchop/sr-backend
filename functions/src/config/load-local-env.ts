import * as dotenv from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";
import { isDeployedCloudRuntime } from "../utils/smartrefill-env-mode";

/** Load `functions/.env` for emulator and local runs only — never on Cloud Run. */
export function loadLocalEnvIfNeeded(): void {
  if (isDeployedCloudRuntime()) return;
  dotenv.config();
  const secretLocalPath = resolve(process.cwd(), ".secret.local");
  if (existsSync(secretLocalPath)) {
    dotenv.config({ path: secretLocalPath, override: true });
  }
}
