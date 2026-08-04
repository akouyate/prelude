import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Instrument_Serif, Plus_Jakarta_Sans } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { QueryProvider } from "../src/providers/query-provider";
import {
  afterSignInUrl,
  afterSignUpUrl,
  isConsoleAuthClerkEnabled,
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
  title: {
    default: "HireCall",
    template: "%s · HireCall",
  },
  description:
    "Create role-specific pre-interviews and review candidate evidence with HireCall.",
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
  const app = (
    <NuqsAdapter>
      <QueryProvider>{children}</QueryProvider>
    </NuqsAdapter>
  );

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${titleSans.variable} ${instrumentSerif.variable}`}
      >
        {isConsoleAuthClerkEnabled ? (
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
