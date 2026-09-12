import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WAKE · Causal Market Response",
  description: "Evidence-backed incident investigation, causal exposure mapping, and paper execution for Bitget markets.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
