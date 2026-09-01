import { cookies } from "next/headers";
import { OneLedgerLogo } from "../../components/brand/OneLedgerLogo";
import { VerifyEmailPanel } from "../../components/VerifyEmailPanel";
import {
  decodePendingValue,
  PENDING_VERIFICATION_EMAIL_COOKIE,
  VERIFICATION_RESEND_AT_COOKIE,
  VERIFICATION_RESEND_COOLDOWN_SECONDS,
} from "../../lib/pending-verification";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["expired", "invalid", "missing"]);

export default async function VerifyEmailPage({
  searchParams,
}: PageProps<"/verify-email">) {
  const cookieStore = await cookies();
  const query = await searchParams;
  const rawStatus = typeof query.status === "string" ? query.status : null;
  const status = STATUSES.has(rawStatus ?? "")
    ? (rawStatus as "expired" | "invalid" | "missing")
    : null;
  const email = decodePendingValue(
    cookieStore.get(PENDING_VERIFICATION_EMAIL_COOKIE)?.value,
  );
  const parsedResendAt = Number(
    cookieStore.get(VERIFICATION_RESEND_AT_COOKIE)?.value ?? 0,
  );

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-10">
      <OneLedgerLogo height={40} className="mx-auto" />
      <VerifyEmailPanel
        email={email}
        initialNow={Number.isFinite(parsedResendAt) && parsedResendAt > 0
          ? parsedResendAt - VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000
          : 0}
        initialResendAvailableAt={Number.isFinite(parsedResendAt)
          ? parsedResendAt
          : 0}
        status={status}
      />
    </div>
  );
}
