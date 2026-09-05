"use client";

import { useEffect, useId, useRef } from "react";
import { useRouter } from "next/navigation";
import { DocumentIcon, GearIcon, InboxIcon, ListIcon, PayIcon, PieIcon, PlugIcon, StarIcon, UsersIcon } from "./icons";
import {
  type ExperienceMode,
  isSurfaceVisible,
} from "../lib/experience-mode";

// The phone-only "More" destination. Holds the primary destinations that
// don't fit the fixed five-slot bottom bar (Categories / Reports /
// Settings), plus a Pay & Services group when those features are on.
// Modal mechanics mirror components/pay/PayLauncher.tsx exactly:
// Esc + backdrop close, focus trap, focus restored to the trigger,
// background scroll locked, child mounts only while open.

function focusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

type Item = { href: string; label: string; Icon: (p: { className?: string }) => React.JSX.Element };

export function MoreSheet({
  open,
  onClose,
  payEnabled,
  assistedPayEnabled,
  integrationsEnabled,
  experienceMode,
  businessSurfacesEnabled,
}: {
  open: boolean;
  onClose: () => void;
  payEnabled: boolean;
  assistedPayEnabled: boolean;
  integrationsEnabled: boolean;
  experienceMode: ExperienceMode;
  businessSurfacesEnabled: boolean;
}) {
  if (!open) return null;
  return (
    <MorePanel
      onClose={onClose}
      payEnabled={payEnabled}
      assistedPayEnabled={assistedPayEnabled}
      integrationsEnabled={integrationsEnabled}
      experienceMode={experienceMode}
      businessSurfacesEnabled={businessSurfacesEnabled}
    />
  );
}

function MorePanel({
  onClose,
  payEnabled,
  assistedPayEnabled,
  integrationsEnabled,
  experienceMode,
  businessSurfacesEnabled,
}: {
  onClose: () => void;
  payEnabled: boolean;
  assistedPayEnabled: boolean;
  integrationsEnabled: boolean;
  experienceMode: ExperienceMode;
  businessSurfacesEnabled: boolean;
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
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
      onClose();
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
    router.push(href);
    onClose();
  }

  // Integrations is off for a Personal Space regardless of the env flag:
  // the experience mode decides whether the surface is shown at all
  // (assessment section 6.2 - "a personal user should never see ...
  // the developer platform"). Household/Business still require the flag.
  const showIntegrations = integrationsEnabled &&
    isSurfaceVisible(experienceMode, "integrations", {
      businessEnabled: businessSurfacesEnabled,
    });

  const appItems: Item[] = [
    { href: "/inbox", label: "Financial Inbox", Icon: InboxIcon },
    ...(showIntegrations
      ? [{ href: "/integrations", label: "Integrations", Icon: PlugIcon }]
      : []),
    { href: "/categories", label: "Categories", Icon: PieIcon },
    { href: "/reports", label: "Reports", Icon: DocumentIcon },
    { href: "/settings", label: "Settings", Icon: GearIcon },
  ];

  const payItems: Item[] = [];
  if (payEnabled) {
    payItems.push({ href: "/pay/ussd", label: "USSD directory", Icon: ListIcon });
  }
  if (assistedPayEnabled) {
    payItems.push(
      { href: "/pay/activity", label: "Payment activity", Icon: PayIcon },
      { href: "/pay/reconciliation", label: "Reconciliation", Icon: PayIcon },
      { href: "/pay/recipients", label: "Trusted recipients", Icon: UsersIcon },
      { href: "/pay/templates", label: "Payment templates", Icon: StarIcon },
    );
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center lg:hidden"
      role="presentation"
    >
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="relative z-10 w-full max-w-lg rounded-t-card border border-border-subtle bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-lg outline-none"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id={titleId} className="text-base font-semibold text-text-primary">
            More
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-control px-2 py-1 text-sm font-medium text-text-secondary hover:bg-background"
          >
            Close
          </button>
        </div>

        <ItemList items={appItems} onPick={go} />

        {payItems.length > 0 && (
          <>
            <p className="mb-1.5 mt-4 text-xs font-medium uppercase tracking-wide text-text-muted">
              Pay &amp; Services
            </p>
            <ItemList items={payItems} onPick={go} />
          </>
        )}
      </div>
    </div>
  );
}

function ItemList({ items, onPick }: { items: Item[]; onPick: (href: string) => void }) {
  return (
    <ul className="flex flex-col">
      {items.map(({ href, label, Icon }) => (
        <li key={href}>
          <button
            type="button"
            onClick={() => onPick(href)}
            className="flex w-full items-center gap-3 rounded-control px-2 py-3 text-left text-sm font-medium text-text-primary hover:bg-background"
          >
            <Icon className="h-5 w-5 text-text-muted" />
            {label}
          </button>
        </li>
      ))}
    </ul>
  );
}
