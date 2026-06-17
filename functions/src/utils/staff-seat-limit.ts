/**
 * Staff seat cap from plan quotas (rider + admin).
 * The workspace owner is always free and is excluded from
 * `limitations.currentStaffCount` and this limit.
 * @param {number} staffRiderMax Max rider seats from plan quotas.
 * @param {number} staffAdminMax Max admin seats from plan quotas.
 * @return {number} Total staff seat capacity (rider + admin).
 */
export function computeStaffSeatLimitFromRoleQuotas(
  staffRiderMax: number,
  staffAdminMax: number,
): number {
  return staffRiderMax + staffAdminMax;
}

/**
 * Add-on boosts apply to the same staff seat pool (not the owner).
 * @param {number} baseStaffSeatLimit Base cap from plan quotas.
 * @param {number} addonStaffRider Extra rider seats from add-ons.
 * @param {number} addonStaffAdmin Extra admin seats from add-ons.
 * @return {number} Total staff seat capacity including add-ons.
 */
export function applyStaffSeatAddonBoosts(
  baseStaffSeatLimit: number,
  addonStaffRider: number,
  addonStaffAdmin: number,
): number {
  return baseStaffSeatLimit + addonStaffRider + addonStaffAdmin;
}
