"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { NETWORK } from "@/lib/gateway";
import { atomicToUsd } from "@/lib/asset";

const LINKS = [
  { href: "/", label: "Chat" },
  { href: "/live", label: "Live" },
  { href: "/analytics", label: "Analytics" },
  { href: "/settings", label: "Settings" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { status, wallet, session } = useSession();

  return (
    <aside className="sidebar">
      <div className="brand">
        Router<span>402</span>
      </div>

      <nav className="nav">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            data-active={pathname === link.href}
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="status" style={{ marginTop: "auto" }}>
        <div className="status-row">
          <span>Wallet</span>
          <span className="mono">
            {wallet ? wallet.accountId : "not connected"}
          </span>
        </div>
        <div className="status-row">
          <span>Session</span>
          <span
            className="pill"
            data-tone={
              status === "session" ? "ok" : status === "loading" ? "" : "bad"
            }
          >
            {status === "loading"
              ? "checking"
              : status === "session"
                ? "active"
                : status === "connected"
                  ? "none"
                  : "disconnected"}
          </span>
        </div>
        {session ? (
          <div className="status-row">
            <span>Spent</span>
            <span className="mono">
              ${atomicToUsd(session.spentAtomic).toFixed(4)} / $
              {atomicToUsd(session.spendCapAtomic).toFixed(2)}
            </span>
          </div>
        ) : null}
        <div className="status-row">
          <span>Network</span>
          <span className="mono">{NETWORK}</span>
        </div>
      </div>
    </aside>
  );
}
