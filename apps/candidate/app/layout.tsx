import type { Metadata } from "next";
import { Geist, Instrument_Serif, Plus_Jakarta_Sans } from "next/font/google";

import { QueryProvider } from "../src/providers/query-provider";
import "./globals.css";

const geistSans = Geist({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-sans",
});

const instrumentSerif = Instrument_Serif({
  display: "swap",
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-display",
  weight: "400",
});

const titleSans = Plus_Jakarta_Sans({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-title-sans",
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
        className={`${geistSans.variable} ${titleSans.variable} ${instrumentSerif.variable}`}
      >
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
