// Copyright (c) 2026, Rademics. All rights reserved.
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/lib/auth-context";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

// The F look's type: Geist for text, Geist Mono for small labels (both SIL Open Font Licence, served from our own site).
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Retail ERP",
  description: "GST billing, stock and accounts for Indian shops, in one place.",
  // The picture shown when the link is shared on WhatsApp, LinkedIn and others (app/opengraph-image.png).
  openGraph: { siteName: "Retail ERP", type: "website", locale: "en_IN" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is set by the boot script before React loads, so it may differ from the server HTML.
    <html lang="en-IN" className={`${geist.variable} ${geistMono.variable}`} data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
