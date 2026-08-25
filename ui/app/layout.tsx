import type { Metadata } from "next";
import Script from "next/script";

import "./globals.css";

export const metadata: Metadata = {
  title: "AI Artist — Memory Postcard Studio",
  description:
    "Turn a small set of meaningful photos into one warm, handmade postcard.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <Script src="/app-config.js" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}
