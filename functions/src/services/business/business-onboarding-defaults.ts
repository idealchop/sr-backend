/**
 * Default onboarding flags on `businesses/{id}` (Firestore).
 * Keep in sync with smartrefill-v3 workspace onboarding types.
 */
export const DEFAULT_QUICK_TOUR_PAGE = {
  accounts: false,
  customers: false,
  dashboard: false,
  inventory: false,
  operations: false,
  profilepopover: false,
  transactions: false,
  /** Post-onboarding video tutorials tour (play any video to finish). */
  tutorials: false,
} as const;

export const DEFAULT_GETTING_STARTED = {
  verifyEmail: false,
  playVideoTutorials: false,
  addCustomer: false,
  addDelivery: false,
  addInventory: false,
  addWalkin: false,
  addExpense: false,
  shareStationLink: false,
  addOnlinePayments: false,
  visitResourcesWebinars: false,
  chatSupport: false,
  useAi: false,
} as const;

export type QuickTourPageKey = keyof typeof DEFAULT_QUICK_TOUR_PAGE;
export type GettingStartedKey = keyof typeof DEFAULT_GETTING_STARTED;
