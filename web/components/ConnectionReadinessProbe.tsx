"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { probeConnectionReadiness } from "../app/settings/connections/actions";

const POLL_MS = 5_000;
const GIVE_UP_MS = 3 * 60 * 1_000;

/**
 * Shown under a connection that is active but has never received a
 * message. Polls the connection's readiness (read-only) and flips to a
 * success line the moment the first real forwarded SMS lands, then
 * refreshes the route so the rest of the row updates too.
 *
 * No synthetic send - see probeConnectionReadiness in the connections
 * actions for why the only test is a real message.
 */
export function ConnectionReadinessProbe({
  connectionId,
}: {
  connectionId: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"waiting" | "ready" | "gave-up">("waiting");
  const deadline = useRef<number | null>(null);

  useEffect(() => {
    if (phase !== "waiting") return;
    if (deadline.current === null) deadline.current = Date.now() + GIVE_UP_MS;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      const res = await probeConnectionReadiness(connectionId);
      if (cancelled) return;

      if (res.ok && res.lastUsedAt) {
        setPhase("ready");
        router.refresh();
        return;
      }
      if (res.ok && res.status !== "active") {
        setPhase("gave-up");
        return;
      }
      if (Date.now() > (deadline.current ?? 0)) {
        setPhase("gave-up");
        return;
      }
      timer = setTimeout(tick, POLL_MS);
    };

    timer = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [connectionId, phase, router]);

  if (phase === "ready") {
    return (
      <p className="text-xs font-medium text-money-positive">
        First message received — this connection is live.
      </p>
    );
  }

  if (phase === "gave-up") {
    return (
      <p className="text-xs text-text-muted">
        No message yet. Trigger a MoMo SMS from your phone, or check the{" "}
        <Link
          href="/settings/connections/setup"
          className="font-medium text-accent hover:underline"
        >
          setup guide
        </Link>
        . This page updates on its own when one arrives.
      </p>
    );
  }

  return (
    <p className="flex items-center gap-2 text-xs text-text-secondary">
      <span
        aria-hidden="true"
        className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent"
      />
      Waiting for the first forwarded message…
    </p>
  );
}
