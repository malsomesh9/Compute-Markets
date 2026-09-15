import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Vericompute — Compute as a market",
  description:
    "An open compute exchange. Programmatic procurement, execution evidence, and Solana settlement.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
