import { redirect } from "next/navigation";
import { getAccessState } from "../../lib/console/access";
import { MfaStep } from "./MfaStep";

export const metadata = { title: "Verify your identity" };

export default async function MfaPage() {
  const { state } = await getAccessState();
  if (state.kind === "signed_out") redirect("/login");
  if (state.kind === "not_staff") redirect("/no-access");
  if (state.kind === "ok") redirect("/dashboard");
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <MfaStep />
    </main>
  );
}
