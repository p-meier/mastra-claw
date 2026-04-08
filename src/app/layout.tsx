import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { assertSupabaseReady } from "@/mastra/lib/bootstrap";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MastraClaw",
  description:
    "Enterprise-ready personal AI agent. Built on frameworks, not from scratch.",
  icons: {
    icon: [
      { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
  },
};

/**
 * Root layout — intentionally minimal. The route-group layouts
 * (`(auth)/layout.tsx`, `(app)/layout.tsx`) own everything visual:
 * the auth section is a dark canvas, the app section gets the sidebar
 * shell. Putting providers here would impose them on both contexts.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Hard-fails on first request if Supabase isn't reachable or migrations
  // haven't been applied. Idempotent — runs once per server process.
  await assertSupabaseReady();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <body>{children}</body>
    </html>
  );
}
