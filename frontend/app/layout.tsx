import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import type { ReactNode } from "react";

import { ServiceWorkerRegister } from "@/components/sw-register";

import "./globals.css";

// next/font downloads these at build time and serves them from this origin, so the CSP stays font-src 'self'.
const instrumentSans = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument-sans", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap" });

// Every page is rendered per request so it receives this request's CSP nonce.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ShadowGuard AI",
  description: "Shadow AI and SaaS data-exposure governance for universities.",
  applicationName: "ShadowGuard AI",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "ShadowGuard", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#101114",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-MY" className={`dark ${instrumentSans.variable} ${plexMono.variable}`}>
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
