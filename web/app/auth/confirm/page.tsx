import { ConfirmEmailPanel } from "../../../components/ConfirmEmailPanel";
import { AuthBackdrop } from "../../../components/auth/AuthBackdrop";
import { OneLedgerLogo } from "../../../components/brand/OneLedgerLogo";

export const dynamic = "force-dynamic";

// Landing spot for the signup-confirmation email link. Renders only - see
// actions.ts for why the actual verifyOtp call waits for a button click
// rather than running here on page load.
export default async function AuthConfirmPage({
  searchParams,
}: PageProps<"/auth/confirm">) {
  const query = await searchParams;
  const tokenHash = typeof query.token_hash === "string" && query.token_hash
    ? query.token_hash
    : null;
  const type = typeof query.type === "string" ? query.type : null;

  return (
    <div className="relative mx-auto flex max-w-sm flex-col gap-6 py-10">
      <AuthBackdrop />
      <OneLedgerLogo height={40} className="mx-auto" />
      <ConfirmEmailPanel tokenHash={type === "email" ? tokenHash : null} />
    </div>
  );
}
