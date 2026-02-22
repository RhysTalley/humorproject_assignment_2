"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type AuthStatus = "loading" | "signedOut" | "signedIn";

type TopNavProps = {
  authStatus: AuthStatus;
  onSignOut: () => void;
};

export default function TopNav({ authStatus, onSignOut }: TopNavProps) {
  const pathname = usePathname();
  const isPopularActive = pathname === "/";
  const isUploadsActive = pathname?.startsWith("/uploads");

  return (
    <header className="mb-10">
      <div className="relative flex items-center justify-center">
        <nav className="flex items-center justify-center gap-4 text-sm font-medium text-zinc-700">
          <Link
            className={`transition ${
              isPopularActive
                ? "text-blue-600"
                : "text-zinc-500 hover:text-zinc-900"
            }`}
            href="/"
          >
            Popular Captions
          </Link>
          <span className="text-zinc-400">|</span>
          <Link
            className={`transition ${
              isUploadsActive
                ? "text-blue-600"
                : "text-zinc-500 hover:text-zinc-900"
            }`}
            href="/uploads"
          >
            Your Uploads
          </Link>
        </nav>
        {authStatus === "signedIn" && (
          <div className="absolute right-0">
            <button
              className="inline-flex items-center justify-center rounded-full border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
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
