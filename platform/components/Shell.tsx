import Image from "next/image";
import Link from "next/link";
import { signOut } from "../app/actions";
import { resolveNav } from "../lib/console/nav";
import { ROLE_LABELS, type Access } from "../lib/console/permissions";
import { SidebarLinks } from "./SidebarLinks";

function envLabel(): { label: string; tone: string } {
  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV;
  if (env === "production") return { label: "Production", tone: "bg-positive-soft text-positive" };
  if (env === "preview") return { label: "Preview", tone: "bg-attention-soft text-attention" };
  return { label: "Development", tone: "bg-info-soft text-info" };
}

export function Shell({
  access,
  email,
  children,
}: {
  access: Access;
  email: string | null;
  children: React.ReactNode;
}) {
  const groups = resolveNav(access);
  const env = envLabel();
  return (
    <div className="min-h-screen md:grid md:grid-cols-[15rem_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="border-b border-border bg-surface md:sticky md:top-0 md:h-screen md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 px-4 py-4">
          <Image src="/brand/mark.png" alt="" width={28} height={28} />
          <div className="leading-tight">
            <Link href="/dashboard" className="text-sm font-semibold">OneLedger</Link>
            <p className="text-[11px] text-text-3">Platform Console</p>
          </div>
        </div>
        <SidebarLinks groups={groups} />
      </aside>

      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-end gap-3 border-b border-border bg-surface px-4 py-2.5 md:px-6">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${env.tone}`}>{env.label}</span>
          <div className="text-right leading-tight">
            <p className="text-xs font-medium">{ROLE_LABELS[access.role]}</p>
            <p className="max-w-[14rem] truncate text-[11px] text-text-3">{email ?? "—"}</p>
          </div>
          <form action={signOut}>
            <button className="rounded-control border border-border-strong px-2.5 py-1 text-xs hover:bg-surface-muted">
              Sign out
            </button>
          </form>
        </header>
        <main id="main" className="px-4 py-5 md:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
