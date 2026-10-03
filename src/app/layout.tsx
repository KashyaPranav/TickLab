import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { ThemeScript } from "@/components/theme-script";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { Analytics, ConsentBanner } from "@/components/analytics";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ticklab.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "TickLab — Habit tracker that works offline",
    template: "%s · TickLab",
  },
  description:
    "TickLab is a fast, offline-first habit tracker. Tick off habits in under 30 seconds, keep your streak anywhere, and install it like an app.",
  applicationName: "TickLab",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TickLab",
  },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "TickLab",
    title: "TickLab — Habit tracker that works offline",
    description:
      "A fast, offline-first habit tracker. Tick off habits in under 30 seconds and keep your streak anywhere.",
  },
  twitter: {
    card: "summary_large_image",
    title: "TickLab — Habit tracker that works offline",
    description: "A fast, offline-first habit tracker. Works in airplane mode.",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180" }],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfb" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1e26" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <a href="#main" className="sr-only-focusable z-50 rounded-md bg-accent px-4 py-2 text-accent-contrast">
          Skip to content
        </a>
        {/* Registers the service worker that makes the app open offline. */}
        <ServiceWorkerRegistration />
        {children}
        <Toaster position="top-center" richColors closeButton />
        <Analytics />
        <ConsentBanner />
      </body>
    </html>
  );
}