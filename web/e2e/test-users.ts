// Fixed test-user identity for this e2e suite. Safe to hardcode: this
// user only ever exists in a throwaway local Supabase stack created fresh
// by `supabase start` for a single test run (see e2e/auth.setup.ts and
// production-guard.ts) - never a real account, never created against the
// linked production project.
export const E2E_USER = {
  email: "e2e-shell-suite@oneledger.test",
  password: "e2e-Test-Password-1!",
} as const;

export const AUTH_STORAGE_STATE_PATH = "e2e/.auth/user.json";
