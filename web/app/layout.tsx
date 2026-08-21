import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { AppShell } from "../components/AppShell";
import { supabaseSession } from "../lib/supabase-session-server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Personal Finance",
  description: "MoMo balance, transactions, and categories.",
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

  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full bg-background font-sans text-text-primary">
        <AppShell userEmail={user?.email ?? null}>{children}</AppShell>
      </body>
    </html>
  );
}
