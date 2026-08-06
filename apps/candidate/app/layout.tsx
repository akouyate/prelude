import type { Metadata } from "next";
import { EB_Garamond, Figtree, Geist, Geist_Mono } from "next/font/google";

import { QueryProvider } from "../src/providers/query-provider";
import "./globals.css";

const bodySans = Geist({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-geist",
  weight: ["300", "400", "500"],
});

const titleSans = Figtree({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-figtree",
  weight: ["400", "500", "600", "700"],
});

const displaySerif = EB_Garamond({
  display: "swap",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-eb-garamond",
  weight: ["400", "500"],
});

const microMono = Geist_Mono({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-geist-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Interview · HireCall",
  description: "Secure candidate pre-interview experience by HireCall.",
  icons: {
    icon: [
      { type: "image/svg+xml", url: "/favicon.svg" },
      { sizes: "32x32", type: "image/png", url: "/favicon-32x32.png" },
    ],
    apple: [{ sizes: "180x180", url: "/apple-touch-icon.png" }],
    shortcut: ["/favicon.ico"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${bodySans.variable} ${titleSans.variable} ${displaySerif.variable} ${microMono.variable}`}
      >
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
