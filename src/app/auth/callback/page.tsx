import { Suspense } from "react";
import AuthCallbackClient from "./AuthCallbackClient";

export const dynamic = "force-dynamic";

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0b0f17] px-6 py-12 text-zinc-100">
          <main className="mx-auto max-w-2xl rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-300 shadow-[0_20px_40px_rgba(0,0,0,0.35)]">
            Finishing sign-in, redirecting you to the admin console...
          </main>
        </div>
      }
    >
      <AuthCallbackClient />
    </Suspense>
  );
}
