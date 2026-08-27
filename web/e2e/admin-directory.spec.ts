import { test, expect } from "./fixtures";

// Pay & Services - Phase P (Directory Management admin surface).
//
// The e2e test user is an ordinary account - never a platform admin and
// with no directory.* grant - so every /admin/directory route must
// resolve to the app's not-found page (the pages call notFound() when
// getDirectoryAccess().canViewAdmin is false). The RPC-level behaviour
// (permission checks, the publication state machine, the PIN-parameter
// rejection, evidence visibility) is covered exhaustively by the
// "Phase P" block in supabase/migrations/tests/run_migration_tests.sh -
// this spec only guards the UI's own authorization gate, matching how
// Phase M's /admin/ussd surface is (not) covered here.

const GUARDED = [
  "/admin/directory",
  "/admin/directory/networks",
  "/admin/directory/networks/new",
  "/admin/directory/institutions",
  "/admin/directory/routes",
  "/admin/directory/routes/new",
  "/admin/directory/sources",
  "/admin/directory/suggestions",
  "/admin/directory/permissions",
];

for (const path of GUARDED) {
  test(`a non-admin cannot reach ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByText("We couldn't find that.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Directory Management" })).toHaveCount(0);
  });
}
