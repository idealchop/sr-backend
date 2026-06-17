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
} as const;

export const DEFAULT_GETTING_STARTED = {
  addCollection: false,
  addCustomer: false,
  addDelivery: false,
  addExpense: false,
  addInventory: false,
  addPaymentAccount: false,
  addWalkin: false,
  useAi: false,
  verifyEmail: false,
} as const;

export type QuickTourPageKey = keyof typeof DEFAULT_QUICK_TOUR_PAGE;
export type GettingStartedKey = keyof typeof DEFAULT_GETTING_STARTED;
