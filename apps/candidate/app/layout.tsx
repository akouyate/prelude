import type { Metadata } from "next";

import { QueryProvider } from "../src/providers/query-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prelude.ai Candidate",
  description: "Candidate pre-interview experience."
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
