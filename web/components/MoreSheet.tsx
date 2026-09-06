"use client";

import { useEffect, useId, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  type ExperienceMode,
  isSurfaceVisible,
} from "../lib/experience-mode";
import { MORE_GROUPS, type MoreIconKey, type MoreItem } from "../lib/navigation";
import {
  BellIcon,
  BookmarkIcon,
  CodeIcon,
  DocumentIcon,
  GearIcon,
  GridIcon,
  LinkIcon,
  PhoneIcon,
  ReceiptIcon,
  ShieldIcon,
  TagIcon,
  UsersIcon,
} from "./icons";

// key -> glyph, mirroring AppShell's NAV_ICONS indirection so lib/navigation
// stays component-free.
const MORE_ICONS: Record<
  MoreIconKey,
  (props: { className?: string }) => React.JSX.Element
> = {
  categories: TagIcon,
  reports: DocumentIcon,
  sources: LinkIcon,
  bills: ReceiptIcon,
  members: UsersIcon,
  settings: GearIcon,
  notifications: BellIcon,
  integrations: GridIcon,
  developer: CodeIcon,
  ussd: PhoneIcon,
  recipients: ShieldIcon,
  templates: BookmarkIcon,
};

// The "More" panel - the structured home for everything that is not on the
// fixed primary journey (assessment section 19). Grouped, not a flat list:
// Manage money / This Space / Account / Advanced / Pay & Services. Each
// item is hidden unless the active experience mode grants its surface AND
// (where set) its feature flag is on. Opened from the phone bottom bar and
// the desktop header "More" button - one implementation for both.
//
// Modal mechanics mirror components/pay/PayLauncher.tsx: Esc + backdrop
// close, focus trap, focus restored to the trigger, background scroll
// locked, child mounts only while open.

function focusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

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

  // Escape closes the sheet from anywhere - a document listener rather
  // than the panel's onKeyDown so it does not depend on focus having
  // already moved into the panel (the focus rAF above may not have run
  // yet when a fast keypress arrives).
  useEffect(() => {
    function onDocKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onDocKeyDown);
    return () => document.removeEventListener("keydown", onDocKeyDown);
  }, [onClose]);

  function onKeyDown(e: React.KeyboardEvent) {
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

  function itemVisible(item: MoreItem): boolean {
    if (
      item.surface !== null &&
      !isSurfaceVisible(experienceMode, item.surface, {
        businessEnabled: businessSurfacesEnabled,
      })
    ) {
      return false;
    }
    if (item.requires === "integrations" && !integrationsEnabled) return false;
    if (item.requires === "pay" && !payEnabled) return false;
    if (item.requires === "assistedPay" && !assistedPayEnabled) return false;
    return true;
  }

  const groups = MORE_GROUPS
    .map((group) => ({
      title: group.title,
      items: group.items.filter(itemVisible),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center sm:items-center"
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
        className="relative z-10 max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-card border border-border-subtle bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-lg outline-none sm:rounded-card sm:pb-5"
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

        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <section key={group.title}>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">
                {group.title}
              </p>
              <ul className="flex flex-col">
                {group.items.map((item) => {
                  const Icon = MORE_ICONS[item.icon];
                  return (
                    <li key={item.href}>
                      <button
                        type="button"
                        onClick={() => go(item.href)}
                        className="flex w-full items-center gap-3 rounded-control px-2 py-3 text-left text-sm font-medium text-text-primary hover:bg-background"
                      >
                        <Icon className="h-5 w-5 shrink-0 text-text-muted" />
                        {item.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
