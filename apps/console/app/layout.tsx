import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Instrument_Serif, Plus_Jakarta_Sans } from "next/font/google";

import { QueryProvider } from "../src/providers/query-provider";
import {
  afterSignInUrl,
  afterSignUpUrl,
  isClerkConfigured,
  signInUrl,
  signUpUrl,
} from "../src/server/auth/clerk-config";
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
  title: "Prelude.ai Console",
  description: "Recruiter console for Prelude.ai pre-interviews."
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  const app = <QueryProvider>{children}</QueryProvider>;

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${titleSans.variable} ${instrumentSerif.variable}`}
      >
        {isClerkConfigured ? (
          <ClerkProvider
            afterSignOutUrl={signInUrl}
            signInFallbackRedirectUrl={afterSignInUrl}
            signInUrl={signInUrl}
            signUpFallbackRedirectUrl={afterSignUpUrl}
            signUpUrl={signUpUrl}
          >
            {app}
          </ClerkProvider>
        ) : (
          app
        )}
      </body>
    </html>
  );
}
