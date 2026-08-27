// Hard safety gate for this e2e suite, mirroring
// supabase/migrations/tests/run_migration_tests.sh's own
// assert_not_production_target(): the suite's setup script holds a
// service-role Supabase client (needed to create/confirm a throwaway
// test user without an email round trip), and a service-role client is
// exactly the credential this project treats as most dangerous to point
// at the wrong project by accident. This runs before that client is ever
// constructed, refusing outright if the configured Supabase URL looks
// like the linked production project in any way - regardless of what
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY happen to be set to, in either a
// local run or CI.
const PRODUCTION_HOST_PATTERNS = [
  /supabase\.co/i,
  /supabase\.com/i,
  /pooler\.supabase\.com/i,
  /zttxsaiywkfrbdxgzbjd/i,
];

export function assertNotProductionSupabaseUrl(url: string): void {
  if (PRODUCTION_HOST_PATTERNS.some((pattern) => pattern.test(url))) {
    throw new Error(
      `Refusing to run the e2e suite against '${url}' - this looks like a ` +
        "Supabase-managed or project-specific hostname. This suite must " +
        "only ever target a disposable local Supabase stack " +
        "(`supabase start`), never the linked production project.",
    );
  }
}
