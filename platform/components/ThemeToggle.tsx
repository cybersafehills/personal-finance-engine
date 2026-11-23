"use client";

import { Icon } from "./ui/Icon";

type Theme = "light" | "dark";

// Persists the choice in a cookie so the server renders the right data-theme on
// first paint (no flash). No cookie = follow the OS. The icon is chosen by CSS
// (see .theme-sun / .theme-moon in globals.css) so there is no state to sync.
export function ThemeToggle({ initial }: { initial: Theme | null }) {
  void initial;
  return (
    <button
      type="button"
      onClick={() => {
        const root = document.documentElement;
        const isDark = root.dataset.theme
          ? root.dataset.theme === "dark"
          : window.matchMedia("(prefers-color-scheme: dark)").matches;
        const next: Theme = isDark ? "light" : "dark";
        root.dataset.theme = next;
        document.cookie = `oc_theme=${next}; path=/; max-age=31536000; samesite=lax; secure`;
      }}
      aria-label="Toggle light and dark theme"
      title="Toggle theme"
      className="inline-flex h-8 w-8 items-center justify-center rounded-control border border-border text-text-2 hover:bg-surface-hover hover:text-text"
    >
      <span className="theme-sun"><Icon name="sun" /></span>
      <span className="theme-moon"><Icon name="moon" /></span>
    </button>
  );
}
