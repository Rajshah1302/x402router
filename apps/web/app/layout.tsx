import type { Metadata } from "next";
import { Press_Start_2P, VT323 } from "next/font/google";
import { SessionProvider } from "@/lib/session-context";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

// Pixel display face for headings/UI chrome; terminal face for body text so
// chat and paragraphs stay readable.
const display = Press_Start_2P({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

const body = VT323({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Router402",
  description:
    "Pay-per-call AI inference, settled in HBAR on Hedera with x402.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
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
