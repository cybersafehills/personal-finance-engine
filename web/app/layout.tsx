import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Geist } from "next/font/google";
import { AppShell } from "../components/AppShell";
import { BrandSplashScreen, SPLASH_CRITICAL_CSS } from "../components/brand/BrandSplashScreen";
import { supabaseSession } from "../lib/supabase-session-server";
import { getActiveWorkspaceId, getUiPreferences, getUserWorkspaces } from "../lib/queries";
import { DEFAULT_NAV_ORDER } from "../lib/navigation";
import {
  isAssistedPayEnabled,
  isPayServicesEnabled,
  isScanToPayEnabled,
} from "../lib/pay/gate";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OneLedger",
  description: "MoMo balance, transactions, and categories.",
  applicationName: "OneLedger",
  appleWebApp: {
    title: "OneLedger",
  },
  openGraph: {
    title: "OneLedger",
    siteName: "OneLedger",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f6f6f7",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Documented kill switch for the branded opening screen. Also how the
  // e2e suite opts out globally so the splash never interferes with the
  // hundreds of existing navigation / visual specs (see e2e/fixtures.ts);
  // e2e/brand-splash.spec.ts clears the cookie to test the real feature.
  const splashDisabled =
    (await cookies()).get("oneledger_splash_off")?.value === "1";

  // Fetched once here, in the root layout, and threaded down as props -
  // never re-fetched separately by the header, mobile nav, desktop nav,
  // or dashboard components (master prompt §18's "single source of
  // truth" requirement). This also gives the shell its nav order and
  // privacy preference on the very first server-rendered paint, so there
  // is no client-side fetch and no flash of an unmasked balance or a
  // default nav order before the real one loads (§6.4/§11.1).
  const [workspaces, activeWorkspaceId, uiPreferences] = user
    ? await Promise.all([
        getUserWorkspaces(),
        getActiveWorkspaceId(),
        getUiPreferences(),
      ])
    : [
        [],
        null,
        {
          navOrder: DEFAULT_NAV_ORDER,
          hideBalance: false,
          privacyMode: false,
          reportsRelocationNoticeDismissed: true,
        },
      ];

  // Server-authoritative: the global Pay action only renders where the
  // feature is on for this user's workspace (env flag + optional
  // allowlist, see lib/pay/gate.ts). Every Pay/USSD action re-checks
  // this independently - the flag is not merely a hidden button.
  const payEnabled = Boolean(user) && isPayServicesEnabled(activeWorkspaceId);
  const assistedPayEnabled = payEnabled && isAssistedPayEnabled(activeWorkspaceId);
  const scanToPayEnabled = payEnabled && isScanToPayEnabled(activeWorkspaceId);

  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full bg-background font-sans text-text-primary">
        {/* Critical opening-screen CSS, hoisted into <head> by React so it
            applies on the first frame - it must not wait for the app's
            main (render-blocking) stylesheet, which on a slow connection
            arrives after the splash markup has already been parsed. */}
        <style
          href="oneledger-splash-critical"
          precedence="high"
          dangerouslySetInnerHTML={{ __html: SPLASH_CRITICAL_CSS }}
        />
        {/* First child of <body>: in the initial SSR HTML so a white field
            + centred logo paint before hydration, with the app mounting
            behind it. Removes itself from the DOM once it finishes.  */}
        <BrandSplashScreen disabled={splashDisabled} />
        <AppShell
          userEmail={user?.email ?? null}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          navOrder={uiPreferences.navOrder}
          hideBalance={uiPreferences.hideBalance}
          privacyMode={uiPreferences.privacyMode}
          reportsRelocationNoticeDismissed={uiPreferences.reportsRelocationNoticeDismissed}
          payEnabled={payEnabled}
          assistedPayEnabled={assistedPayEnabled}
          scanToPayEnabled={scanToPayEnabled}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
