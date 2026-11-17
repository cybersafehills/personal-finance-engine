"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { setDefaultWalletAction } from "../app/wallets/actions";
import { dateGroupLabel, formatTime } from "../lib/format";
import type { HomeWalletCard } from "../lib/wallets/home-wallets";
import { EyeIcon, EyeOffIcon } from "./icons";
import { usePrivacy } from "./PrivacyProvider";

// One balance card per wallet, swiped sideways. Wallets are separate accounts
// with their own accounting, so they are never added together here. The default
// wallet is first; "Make default" on any other card moves it to the front.
export function BalanceCarousel({ cards }: { cards: HomeWalletCard[] }) {
  const { isBalanceMasked, balanceHiddenByPrivacyMode, toggleBalanceVisible, isSavingBalanceVisibility } =
    usePrivacy();
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onScroll() {
    const el = scroller.current;
    if (!el || el.children.length === 0) return;
    const first = el.children[0] as HTMLElement;
    const step = first.offsetWidth + 12;
    setActive(Math.min(cards.length - 1, Math.max(0, Math.round(el.scrollLeft / step))));
  }

  function makeDefault(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await setDefaultWalletAction(id);
      if (!res.ok) setError(res.error);
      else scroller.current?.scrollTo({ left: 0, behavior: "smooth" });
    });
  }

  return (
    <section aria-label="Wallet balances">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {cards.map((c, i) => (
          <article
            key={c.id}
            aria-label={`${c.name} balance`}
            aria-roledescription="slide"
            className={`rounded-card bg-accent px-6 py-7 text-accent-foreground shadow-sm snap-center shrink-0 ${
              cards.length > 1 ? "basis-[90%] lg:basis-[75%]" : "basis-full"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-accent-foreground/80">
                {c.name}
                {c.isDefault && (
                  <span className="ml-2 rounded-full bg-accent-foreground/15 px-2 py-0.5 text-xs">
                    Default
                  </span>
                )}
              </p>
              {i === 0 && (
                <button
                  type="button"
                  onClick={toggleBalanceVisible}
                  disabled={balanceHiddenByPrivacyMode || isSavingBalanceVisibility}
                  aria-label={isBalanceMasked ? "Show balances" : "Hide balances"}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-accent-foreground/80 hover:bg-accent-foreground/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isBalanceMasked ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                </button>
              )}
            </div>
            <p className="mt-2 text-4xl font-semibold tabular-nums sm:text-5xl">
              {isBalanceMasked ? "••••••" : c.amountText ?? "—"}
            </p>
            <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <p className="text-sm text-accent-foreground/70">
                {c.subtitle} · {c.statusLabel}
              </p>
              {c.asOfIso && (
                <p className="text-xs text-accent-foreground/60">
                  Updated {dateGroupLabel(c.asOfIso)}, {formatTime(c.asOfIso)}
                </p>
              )}
            </div>
            <div className="mt-3 flex items-center gap-4 text-sm">
              <Link href="/wallets" className="underline underline-offset-2">
                Details
              </Link>
              {!c.isDefault && (
                <button
                  type="button"
                  onClick={() => makeDefault(c.id)}
                  disabled={pending}
                  className="min-h-11 underline underline-offset-2 disabled:opacity-60"
                >
                  Make default
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {cards.length > 1 && (
        <div className="mt-2 flex justify-center gap-1.5" aria-hidden="true">
          {cards.map((c, i) => (
            <span
              key={c.id}
              className={`h-1.5 w-1.5 rounded-full ${i === active ? "bg-accent" : "bg-border-subtle"}`}
            />
          ))}
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-attention">{error}</p>}
    </section>
  );
}
