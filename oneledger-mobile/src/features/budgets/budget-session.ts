import { createClient } from "@supabase/supabase-js";

import { supabase } from "@/api/supabase";
import { selectedWorkspaceId } from "@/features/spaces/selected-space";
import { config } from "@/lib/config";

export type BudgetScope = { workspaceId: string; userId: string };

export async function budgetSession(scope: BudgetScope) {
  if (!supabase || selectedWorkspaceId() !== scope.workspaceId) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user.id !== scope.userId || selectedWorkspaceId() !== scope.workspaceId) return null;
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });
}
