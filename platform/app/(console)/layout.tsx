import { Shell } from "../../components/Shell";
import { requireSession } from "../../lib/console/access";

// Every page under this layout requires: signed in + active staff + MFA.
export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <Shell access={session.access} email={session.email}>
      {children}
    </Shell>
  );
}
