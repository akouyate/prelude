import type { Metadata } from "next";

import { QueryProvider } from "../src/providers/query-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prelude.ai Console",
  description: "Recruiter console for Prelude.ai pre-interviews."
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
