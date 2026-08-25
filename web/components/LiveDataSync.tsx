"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "../lib/supabase-browser";

// Every table a page under app/ reads from to render live financial data -
// see supabase/migrations/20260828000000_realtime_publication.sql, which
// is what actually makes Postgres changes on these tables reach this
// client at all. Keep the two lists in sync when either changes.
const LIVE_TABLES = [
  "transactions",
  "accounts",
  "transaction_splits",
  "transfer_links",
  "budgets",
  "budget_allocations",
  "budget_category_mappings",
  "financial_goals",
  "goal_contributions",
] as const;

const REFRESH_DEBOUNCE_MS = 400;

/**
 * Keeps every server-rendered page live: subscribes to Postgres changes
 * (via Supabase Realtime) on the tables that drive this app's data, scoped
 * to the caller's active workspace, and re-runs the current route's server
 * components (router.refresh()) whenever a row changes - new MoMo
 * transaction ingested, a category edited, a budget updated elsewhere,
 * etc. RLS (transactions_select_member and its siblings) is what actually
 * limits which rows a subscriber sees; the workspace_id filter here just
 * avoids paying for events the RLS check would drop anyway.
 *
 * Rendered once, unconditionally logged-in, from AppShell - it has no
 * visual output of its own.
 */
export function LiveDataSync({ workspaceId }: { workspaceId: string | null }) {
  const router = useRouter();
  const refreshTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!workspaceId) return;

    const supabase = supabaseBrowser();
    const channel = supabase.channel(`live-data-sync:${workspaceId}`);
    let cancelled = false;

    const scheduleRefresh = (payload: unknown) => {
      // eslint-disable-next-line no-console
      console.debug("[LiveDataSync] change received, refreshing", payload);
      if (refreshTimeout.current) clearTimeout(refreshTimeout.current);
      refreshTimeout.current = setTimeout(() => {
        router.refresh();
      }, REFRESH_DEBOUNCE_MS);
    };

    for (const table of LIVE_TABLES) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `workspace_id=eq.${workspaceId}` },
        scheduleRefresh,
      );
    }

    // The realtime client authorizes each channel with whatever session
    // token it currently holds - a freshly-constructed client (every
    // mount creates its own via supabaseBrowser()) may not have finished
    // loading that session from storage yet. Subscribing before it does
    // silently yields a channel that never receives events instead of an
    // error, since RLS just sees an unauthenticated request and drops
    // everything. Waiting for the session first avoids that race.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session) supabase.realtime.setAuth(session.access_token);
      channel.subscribe((status, err) => {
        // eslint-disable-next-line no-console
        console.debug("[LiveDataSync] channel status:", status, err ?? "");
      });
    });

    return () => {
      cancelled = true;
      if (refreshTimeout.current) clearTimeout(refreshTimeout.current);
      supabase.removeChannel(channel);
    };
  }, [workspaceId, router]);

  return null;
}
