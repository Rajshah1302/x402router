import type { Metadata } from "next";
import { SessionProvider } from "@/lib/session-context";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Router402",
  description:
    "Pay-per-call AI inference, settled in USDC on Hedera with x402.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <div className="shell">
            <Sidebar />
            <main className="main">{children}</main>
          </div>
        </SessionProvider>
      </body>
    </html>
  );
}
