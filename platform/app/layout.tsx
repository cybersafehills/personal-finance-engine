import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "OneLedger Platform Console", template: "%s · OneLedger Platform" },
  description: "Operations console for OneLedger staff.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const raw = (await cookies()).get("oc_theme")?.value;
  const theme = raw === "dark" || raw === "light" ? raw : undefined;
  return (
    <html lang="en" className={GeistSans.variable} data-theme={theme}>
      <body className="min-h-screen bg-canvas font-sans text-text antialiased">
        {children}
      </body>
    </html>
  );
}
