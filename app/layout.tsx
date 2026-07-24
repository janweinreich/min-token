import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "../src/app/globals.css";

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "mintoken | quality-gated LLM routing",
  description:
    "Evolve LLM routing to cut spend without losing quality. Memory, Pioneer, Senso, Guild, Band, and Replay in one live loop.",
  openGraph: {
    title: "mintoken",
    description: "Cut LLM spend. Hold quality.",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "mintoken routing dashboard" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "mintoken",
    description: "Cut LLM spend. Hold quality.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} ${geistSans.className}`}>
        {children}
      </body>
    </html>
  );
}
