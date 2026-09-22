import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WAKE · Event driven trading agent",
  description: "WAKE reads exploits and exchange deposits from the chain, measures who absorbs them, and lets Claude decide the trade while code enforces the money. Bitget Demo only.",
  icons: {
    icon: "/brand/favicon.svg",
    shortcut: "/brand/favicon.svg",
    apple: "/brand/favicon.svg",
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
