import { cookies } from "next/headers";
import { signOut } from "../app/actions";
import { can, ROLE_LABELS, type Access } from "../lib/console/permissions";
import { resolveNav } from "../lib/console/nav";
import { ShellFrame } from "./ShellFrame";

function envLabel(): { label: string; tone: string } {
  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV;
  if (env === "production") return { label: "Production", tone: "bg-positive-soft text-positive-ink" };
  if (env === "preview") return { label: "Preview", tone: "bg-attention-soft text-attention-ink" };
  return { label: "Development", tone: "bg-info-soft text-info-ink" };
}

export async function Shell({
  access,
  email,
  children,
}: {
  access: Access;
  email: string | null;
  children: React.ReactNode;
}) {
  const jar = await cookies();
  const raw = jar.get("oc_theme")?.value;
  const theme = raw === "dark" || raw === "light" ? raw : null;
  return (
    <ShellFrame
      groups={resolveNav(access)}
      roleLabel={ROLE_LABELS[access.role]}
      email={email}
      env={envLabel()}
      theme={theme}
      canSearchCustomers={can(access, "view_customer_metadata")}
      signOutSlot={
        <form action={signOut}>
          <button className="rounded-control border border-border px-2.5 py-1.5 text-xs font-medium text-text-2 hover:bg-surface-hover hover:text-text">
            Sign out
          </button>
        </form>
      }
    >
      {children}
    </ShellFrame>
  );
}
