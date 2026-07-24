import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "BudgetDarwin — the agent that learns what each question costs",
  description: "Replay-first, quality-gated model routing that evolves its own policy.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
