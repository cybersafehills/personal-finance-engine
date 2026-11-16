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
    let fallbackPoll: ReturnType<typeof setInterval> | null = null;

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
    // Silent-stall guards. (1) The realtime socket authorizes with the JWT it
    // was given; when Supabase rotates it (hourly) a stale token makes the
    // channel quietly stop delivering. Push every new token through.
    // (2) Backgrounded/sleeping tabs drop the websocket and miss events, so
    // catch up with a refresh whenever the tab becomes visible again.
    const { data: authSub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") scheduleRefresh("visibility");
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session) supabase.realtime.setAuth(session.access_token);
      channel.subscribe((status, err) => {
        // eslint-disable-next-line no-console
        console.debug("[LiveDataSync] channel status:", status, err ?? "");
        // On a dropped/errored channel, fall back to polling until the
        // client's own reconnect restores SUBSCRIBED.
        if (status === "SUBSCRIBED") {
          if (fallbackPoll) clearInterval(fallbackPoll);
          fallbackPoll = null;
        } else if (
          (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") &&
          !fallbackPoll && !cancelled
        ) {
          fallbackPoll = setInterval(() => {
            if (document.visibilityState === "visible") router.refresh();
          }, 15000);
        }
      });
    });

    return () => {
      cancelled = true;
      if (fallbackPoll) clearInterval(fallbackPoll);
      authSub.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      if (refreshTimeout.current) clearTimeout(refreshTimeout.current);
      supabase.removeChannel(channel);
    };
  }, [workspaceId, router]);

  return null;
}
