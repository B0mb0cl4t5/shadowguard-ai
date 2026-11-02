import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { ReactNode } from "react";

import { ServiceWorkerRegister } from "@/components/sw-register";

import "./globals.css";

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
  themeColor: "#05070d",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-MY" className={`dark ${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <div className="aurora" aria-hidden />
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
