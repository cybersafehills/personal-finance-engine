"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { searchCustomers, type CustomerHit } from "../app/(console)/search-actions";
import type { ResolvedNavGroup } from "../lib/console/nav";
import { Icon } from "./ui/Icon";

type Result =
  | { kind: "page"; label: string; hint: string; href: string; icon: string }
  | { kind: "customer"; label: string; hint: string; href: string; icon: string };

export function CommandPalette({
  groups,
  canSearchCustomers,
}: {
  groups: ResolvedNavGroup[];
  canSearchCustomers: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [fetched, setFetched] = useState<{ q: string; hits: CustomerHit[] }>({ q: "", hits: [] });
  const [active, setActive] = useState(0);
  const [, start] = useTransition();

  const pages = useMemo<Result[]>(
    () =>
      groups.flatMap((g) =>
        g.items
          .filter((i) => i.state === "link" && i.href)
          .map((i) => ({ kind: "page" as const, label: i.label, hint: g.label, href: i.href!, icon: i.icon })),
      ),
    [groups],
  );

  const dialog = () => document.getElementById("cmdk") as HTMLDialogElement | null;
  const open = () => dialog()?.showModal();
  const reset = () => {
    setQ("");
    setFetched({ q: "", hits: [] });
    setActive(0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        (document.getElementById("cmdk") as HTMLDialogElement | null)?.showModal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!canSearchCustomers || q.trim().length < 3) return;
    const t = setTimeout(
      () => start(async () => setFetched({ q, hits: await searchCustomers(q) })),
      250,
    );
    return () => clearTimeout(t);
  }, [q, canSearchCustomers]);

  const results: Result[] = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const p = needle ? pages.filter((x) => x.label.toLowerCase().includes(needle) || x.hint.toLowerCase().includes(needle)) : pages;
    const customers = fetched.q === q && needle.length >= 3 ? fetched.hits : [];
    const c: Result[] = customers.map((h) => ({
      kind: "customer",
      label: h.name ?? `Customer ${h.ref}`,
      hint: `Customer ${h.ref} · ${h.status}`,
      href: `/customers/users?q=${encodeURIComponent(h.ref)}`,
      icon: "users",
    }));
    return [...p, ...c];
  }, [q, pages, fetched]);

  const go = (r: Result | undefined) => {
    if (!r) return;
    dialog()?.close();
    router.push(r.href);
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="flex h-9 w-full max-w-md items-center gap-2 rounded-control border border-border bg-surface-muted px-3 text-sm text-text-3 hover:border-border-strong"
        aria-label="Search pages and customers"
      >
        <Icon name="search" />
        <span className="flex-1 text-left">Search pages and customers…</span>
        <kbd className="hidden rounded border border-border bg-surface px-1.5 text-[11px] sm:inline">⌘K</kbd>
      </button>
      <dialog
        id="cmdk"
        onClose={reset}
        aria-label="Search"
        className="m-auto mt-[12vh] w-[min(36rem,92vw)] overflow-hidden rounded-card border border-border bg-surface p-0 shadow-pop"
        onClick={(e) => e.target === e.currentTarget && dialog()?.close()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Icon name="search" className="text-text-3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              if (e.key === "Enter") { e.preventDefault(); go(results[active]); }
            }}
            placeholder={canSearchCustomers ? "Jump to a page, or type 3+ letters to find a customer" : "Jump to a page"}
            className="h-12 w-full bg-transparent text-sm outline-none"
            aria-label="Search"
          />
          <kbd className="rounded border border-border px-1.5 text-[11px] text-text-3">Esc</kbd>
        </div>
        <ul role="listbox" className="max-h-80 overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-text-3">No matches.</li>
          ) : (
            results.map((r, i) => (
              <li key={`${r.kind}-${r.href}-${i}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r)}
                  className={`flex w-full items-center gap-3 rounded-control px-3 py-2 text-left text-sm ${i === active ? "bg-accent-soft text-accent-ink" : "text-text hover:bg-surface-hover"}`}
                >
                  <Icon name={r.icon} className="shrink-0 text-text-3" />
                  <span className="flex-1 truncate">{r.label}</span>
                  <span className="truncate text-xs text-text-3">{r.hint}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </dialog>
    </>
  );
}
