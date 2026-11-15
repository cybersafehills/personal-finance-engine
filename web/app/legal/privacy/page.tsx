import type { Metadata } from "next";

import { MobilePrivacyPolicy } from "../../../components/legal/MobilePrivacyPolicy";

// Public, static, crawlable: the "Privacy policy" URL for the OneLedger
// mobile app in both stores. `/legal` is in PUBLIC_PATHS (web/proxy.ts).
export const metadata: Metadata = {
  title: "OneLedger mobile app — Privacy Policy",
  description:
    "How the OneLedger mobile app handles your account, notification access, biometric lock and push alerts.",
  robots: { index: true, follow: true },
};

export default function PrivacyPolicyPage() {
  return <MobilePrivacyPolicy />;
}
