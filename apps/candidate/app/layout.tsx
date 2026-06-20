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
  title: "Prelude.ai Candidate",
  description: "Candidate pre-interview experience.",
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
