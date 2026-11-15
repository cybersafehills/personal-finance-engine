import type { Metadata } from "next";

import { MobilePrivacyPolicy } from "../../../components/legal/MobilePrivacyPolicy";

// Kept at this URL because it was given to the Play Console for package
// me.oneledger.companion, which the OneLedger mobile app now replaces. It
// renders the same policy as /legal/privacy (the canonical URL for new
// listings). Must resolve without a OneLedger session: `/legal` is in
// PUBLIC_PATHS (web/proxy.ts).
export const metadata: Metadata = {
  title: "OneLedger mobile app — Privacy Policy",
  description:
    "How the OneLedger mobile app handles your account, notification access, biometric lock and push alerts.",
  robots: { index: true, follow: true },
  alternates: { canonical: "/legal/privacy" },
};

export default function AndroidPrivacyPolicyPage() {
  return <MobilePrivacyPolicy />;
}
