/**
 * Default: no Dev job Cloud Function exports (Prod `./deploy.sh` must not create Dev schedulers).
 * `ENV=dev DEPLOY_DEV_JOBS=1 ./deploy.sh` swaps in `dev-jobs-exports.enabled.ts`.
 */
export const DEV_JOBS_REGISTERED = false;
