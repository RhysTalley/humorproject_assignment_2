"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseClient } from "@/lib/supabaseClient";

export default function AuthCallbackClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const finalizeAuth = async () => {
      const code = searchParams.get("code");
      if (code) {
        await supabaseClient.auth.exchangeCodeForSession(code);
      }
      const {
        data: { session },
      } = await supabaseClient.auth.getSession();

      if (session?.user?.id) {
        const { data, error } = await supabaseClient
          .from("profiles")
          .select("id, is_superadmin")
          .eq("id", session.user.id)
          .maybeSingle();

        if (error || !data?.is_superadmin) {
          await supabaseClient.auth.signOut();
          router.replace("/?auth=not_superadmin");
          return;
        }
      }

      router.replace("/admin");
    };

    void finalizeAuth();
  }, [router, searchParams]);

  return (
    <div className="min-h-screen bg-[#0b0f17] px-6 py-12 text-zinc-100">
      <main className="mx-auto max-w-2xl rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-300 shadow-[0_20px_40px_rgba(0,0,0,0.35)]">
        Finishing sign-in, redirecting you to the admin console...
      </main>
    </div>
  );
}
