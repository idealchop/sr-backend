/**
 * Workspace member seat roles (non-owner). Both are “staff” at the app level
   (`users.appAccess.role` = `staff`).
 * Invites and `members/{uid}.role` use these values — never `admin` | `staff` as a pair.
 */
export type TeamSeatRole = "admin" | "rider";

// eslint-disable-next-line valid-jsdoc
// eslint-disable-next-line valid-jsdoc
/** Map Firestore / API values to a seat role. Legacy invites used `staff` for rider seats. */
export function normalizeSeatRole(raw: unknown): TeamSeatRole {
  const r = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (r === "admin") return "admin";
  if (r === "rider" || r === "staff") return "rider";
  return "rider";
}
