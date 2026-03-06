"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type AuthStatus = "loading" | "signedOut" | "signedIn";

type TopNavProps = {
  authStatus?: AuthStatus;
  onSignOut?: () => void;
};

export default function TopNav({ authStatus, onSignOut }: TopNavProps) {
  const pathname = usePathname();
  const isStatsActive = pathname === "/";
  const isAdminActive = pathname?.startsWith("/admin");

  return (
    <header className="mb-10">
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <nav className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.2em] text-zinc-400">
          <Link
            className={`rounded-full border px-4 py-2 transition ${
              isStatsActive
                ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200 shadow-[0_0_25px_rgba(34,211,238,0.25)]"
                : "border-transparent text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
            }`}
            href="/"
          >
            Stats
          </Link>
          <Link
            className={`rounded-full border px-4 py-2 transition ${
              isAdminActive
                ? "border-fuchsia-400/60 bg-fuchsia-400/10 text-fuchsia-200 shadow-[0_0_25px_rgba(192,132,252,0.25)]"
                : "border-transparent text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
            }`}
            href="/admin"
          >
            Admin
          </Link>
        </nav>
        {authStatus === "signedIn" && onSignOut && (
          <div className="flex items-center">
            <button
              className="inline-flex items-center justify-center rounded-full border border-rose-400/60 bg-rose-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-rose-200 transition hover:bg-rose-400/20"
              onClick={onSignOut}
              type="button"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
