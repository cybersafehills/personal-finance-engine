"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { messages } from "../../lib/ussd/messages";
import {
  CATEGORY_LABELS,
  DIRECTORY_CATEGORIES,
  type DirectoryCategory,
} from "../../lib/ussd/categories";

const t = messages().ussd;

/**
 * Search + category + provider filters for the directory. Debounced;
 * writes to the URL query string so the (server-rendered) list stays the
 * source of truth and the state survives a refresh / share.
 */
export function DirectoryControls({
  providers,
}: {
  providers: { slug: string; display_name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [term, setTerm] = useState(params.get("q") ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const category = params.get("category") ?? "";
  const provider = params.get("provider") ?? "";

  function apply(next: Record<string, string>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }

  useEffect(() => {
    // No-op when the term already matches the URL (initial mount, or a
    // value we just wrote) - avoids a redundant navigation.
    if (term.trim() === (params.get("q") ?? "")) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      // If the user has since navigated into a code's detail page (or
      // anywhere off the list), don't yank them back with a stale search
      // write.
      if (window.location.pathname !== pathname) return;
      apply({ q: term.trim() });
    }, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  return (
    <div className="mb-4 flex flex-col gap-3">
      <label className="block">
        <span className="sr-only">{t.searchLabel}</span>
        <input
          type="search"
          inputMode="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={t.searchPlaceholder}
          aria-label={t.searchLabel}
          // text-base on mobile keeps the computed size at 16px so iOS
          // Safari does not focus-zoom (globals.css enforces this app-wide
          // too; kept explicit here as this is the control in the bug
          // report); text-sm from md: up where zoom can't happen.
          className="w-full min-w-0 rounded-control border border-border-subtle bg-surface px-3 py-2.5 text-base text-text-primary outline-none focus:border-accent md:text-sm"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <label className="flex min-w-0 items-center gap-1.5 text-sm">
          <span className="shrink-0 text-text-muted">{t.categoryLabel}</span>
          <select
            value={category}
            onChange={(e) => apply({ category: e.target.value })}
            className="min-w-0 max-w-full rounded-control border border-border-subtle bg-surface px-2 py-1.5 text-base text-text-primary outline-none focus:border-accent md:text-sm"
          >
            <option value="">{t.allCategories}</option>
            {DIRECTORY_CATEGORIES.map((c: DirectoryCategory) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 items-center gap-1.5 text-sm">
          <span className="shrink-0 text-text-muted">{t.providerLabel}</span>
          <select
            value={provider}
            onChange={(e) => apply({ provider: e.target.value })}
            className="min-w-0 max-w-full rounded-control border border-border-subtle bg-surface px-2 py-1.5 text-base text-text-primary outline-none focus:border-accent md:text-sm"
          >
            <option value="">{t.allProviders}</option>
            {providers.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.display_name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
