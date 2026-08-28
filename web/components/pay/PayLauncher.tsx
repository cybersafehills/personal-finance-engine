"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { messages } from "../../lib/ussd/messages";
import {
  getLauncherSnapshot,
  type LauncherSnapshot,
} from "../../app/pay/actions";
import { CloseIcon, PayIcon, StarIcon } from "../icons";

const t = messages().pay;

const PRIMARY_ACTIONS: { type: string; label: string }[] = [
  { type: "pay_person", label: t.primary.person },
  { type: "pay_merchant", label: t.primary.merchant },
  { type: "pay_bill", label: t.primary.bill },
  { type: "buy_electricity", label: t.primary.electricity },
  { type: "buy_airtime", label: t.primary.airtime },
  { type: "government", label: t.primary.government },
];

function focusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * The Pay & Services launcher. Mobile: a bottom sheet. Desktop/tablet: a
 * centred dialog. Full modal semantics - focus trap, Esc + browser-back
 * to close, focus restored to the trigger, background scroll locked.
 *
 * Phase 1: the payment actions are visibly deferred (disabled + a
 * "coming later" hint - never a fake success). The only live path is
 * "Open USSD directory". One tap never executes a financial action.
 *
 * The panel is a child that only mounts while `open`, so its data /
 * focus state resets cleanly on every open without any in-effect reset.
 */
export function PayLauncher({
  open,
  onClose,
  assistedEnabled,
}: {
  open: boolean;
  onClose: () => void;
  assistedEnabled: boolean;
}) {
  if (!open) return null;
  return <LauncherPanel onClose={onClose} assistedEnabled={assistedEnabled} />;
}

function LauncherPanel({
  onClose,
  assistedEnabled,
}: {
  onClose: () => void;
  assistedEnabled: boolean;
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  // Guards every dismissal path (footer control, overlay, Esc, a nav
  // that closes) so a double tap / Enter-repeat can't fire onClose twice
  // or race a second history pop.
  const closingRef = useRef(false);
  const titleId = useId();

  function requestClose() {
    if (closingRef.current) return;
    closingRef.current = true;
    onClose();
  }
  const [snapshot, setSnapshot] = useState<LauncherSnapshot | null>(null);
  const [, startLoad] = useTransition();

  useEffect(() => {
    startLoad(() => {
      getLauncherSnapshot()
        .then((s) => setSnapshot(s))
        .catch(() => setSnapshot({ favourites: [], recent: [] }));
    });

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const { body } = document;
    const prevOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    const raf = requestAnimationFrame(() => {
      const nodes = panelRef.current ? focusable(panelRef.current) : [];
      (nodes[0] ?? panelRef.current)?.focus();
    });

    return () => {
      cancelAnimationFrame(raf);
      body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      requestClose();
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;
    const nodes = focusable(panelRef.current);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function go(href: string) {
    if (closingRef.current) return;
    // Navigate first, then close - closing unmounts this panel; doing it
    // the other way round briefly races the router.
    router.push(href);
    requestClose();
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center sm:items-center"
      role="presentation"
    >
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={requestClose}
        className="absolute inset-0 cursor-default bg-black/40"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="relative z-10 flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-card border border-border-subtle bg-surface shadow-lg outline-none sm:max-h-[85vh] sm:rounded-card"
      >
        {/* Header - static; the former top-right "Close" is gone, the
            closing control now lives in the sticky footer below. */}
        <div className="flex shrink-0 items-center gap-2.5 px-5 pb-3 pt-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <PayIcon className="h-5 w-5" />
          </span>
          <div>
            <h2 id={titleId} className="text-base font-semibold text-text-primary">
              {t.launcherTitle}
            </h2>
            <p className="text-xs text-text-muted">{t.launcherSubtitle}</p>
          </div>
        </div>

        {/* Scrolls independently of the pinned footer. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          <div className="grid grid-cols-2 gap-2">
            {PRIMARY_ACTIONS.map((a) =>
              assistedEnabled ? (
                <button
                  key={a.type}
                  type="button"
                  onClick={() => go(`/pay/new/${a.type}`)}
                  className="flex flex-col items-start gap-1 rounded-control border border-border-subtle bg-background px-3 py-2.5 text-left hover:border-accent"
                >
                  <span className="text-sm font-medium text-text-primary">{a.label}</span>
                </button>
              ) : (
                <button
                  key={a.type}
                  type="button"
                  disabled
                  aria-disabled="true"
                  title={t.comingSoon}
                  className="flex flex-col items-start gap-1 rounded-control border border-border-subtle bg-background px-3 py-2.5 text-left opacity-60"
                >
                  <span className="text-sm font-medium text-text-secondary">{a.label}</span>
                  <span className="text-[11px] text-text-muted">{t.comingSoon}</span>
                </button>
              ),
            )}
          </div>

          <div className="mt-3 flex flex-col gap-2 border-t border-border-subtle pt-3">
            <button
              type="button"
              onClick={() => go("/pay/ussd")}
              className="flex w-full items-center justify-between rounded-control bg-accent px-3 py-2.5 text-sm font-semibold text-accent-foreground"
            >
              {t.secondary.ussd}
              <span aria-hidden="true">→</span>
            </button>
            {assistedEnabled && (
              <div className="flex gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => go("/pay/activity")}
                  className="flex-1 rounded-control border border-border-subtle px-3 py-2 font-medium text-text-secondary hover:bg-background"
                >
                  {t.secondary.activity}
                </button>
                <button
                  type="button"
                  onClick={() => go("/pay/templates")}
                  className="flex-1 rounded-control border border-border-subtle px-3 py-2 font-medium text-text-secondary hover:bg-background"
                >
                  {t.secondary.template}
                </button>
              </div>
            )}
          </div>

          {snapshot && snapshot.favourites.length > 0 && (
            <LauncherList
              heading={t.favourites}
              entries={snapshot.favourites}
              onPick={(slug) => go(`/pay/ussd/${slug}`)}
              starred
            />
          )}
          {snapshot && snapshot.recent.length > 0 && (
            <LauncherList
              heading={t.recent}
              entries={snapshot.recent}
              onPick={(slug) => go(`/pay/ussd/${slug}`)}
            />
          )}
        </div>

        {/* Pinned footer - stays visible while the content above scrolls,
            clears the home indicator via safe-area padding, and carries
            the single closing control (centred, labelled, >=44px). */}
        <div className="shrink-0 border-t border-border-subtle bg-surface px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={requestClose}
            aria-label={t.closeSheet}
            className="mx-auto flex min-h-11 items-center justify-center gap-1.5 rounded-control px-5 py-2.5 text-sm font-semibold text-text-secondary transition-colors hover:bg-background focus-visible:bg-background active:bg-background"
          >
            <CloseIcon className="h-4 w-4" />
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
}

function LauncherList({
  heading,
  entries,
  onPick,
  starred = false,
}: {
  heading: string;
  entries: LauncherSnapshot["favourites"];
  onPick: (slug: string) => void;
  starred?: boolean;
}) {
  return (
    <div className="mt-3 border-t border-border-subtle pt-3">
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">
        {heading}
      </p>
      <ul className="flex flex-col">
        {entries.map((e) => (
          <li key={e.slug}>
            <button
              type="button"
              onClick={() => onPick(e.slug)}
              className="flex w-full items-center gap-2 rounded-control px-2 py-2 text-left hover:bg-background"
            >
              {starred && <StarIcon filled className="h-4 w-4 text-accent" />}
              <span className="flex-1 truncate text-sm text-text-primary">{e.name}</span>
              <span className="shrink-0 font-mono text-xs text-text-muted">
                {e.ussd_template}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
