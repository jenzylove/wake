import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WAKE · On-chain Incident Response",
  description: "WAKE maps who actually absorbs an on-chain loss, prices it against real traded liquidity, and refuses the position when the arithmetic does not clear.",
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
