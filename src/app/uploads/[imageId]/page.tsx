"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabaseClient";
import type { Database } from "@/types/supabase";
import TopNav from "@/components/TopNav";

type AuthStatus = "loading" | "signedOut" | "signedIn";

type ImageRow = Database["public"]["Tables"]["images"]["Row"];

type CaptionRow = Database["public"]["Tables"]["captions"]["Row"];

const VOTE_STORAGE_KEY_PREFIX = "caption_votes_by_user";

const getVoteStorageKey = (userId: string) =>
  `${VOTE_STORAGE_KEY_PREFIX}:${userId}`;

const loadVotesFromStorage = (userId: string): Record<string, 1 | -1> => {
  try {
    const raw = window.localStorage.getItem(getVoteStorageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: Record<string, 1 | -1> = {};
    Object.entries(parsed).forEach(([captionId, vote]) => {
      if (vote === 1 || vote === -1) {
        next[captionId] = vote;
      }
    });
    return next;
  } catch {
    return {};
  }
};

const saveVotesToStorage = (
  userId: string,
  votes: Record<string, 1 | -1>,
) => {
  try {
    window.localStorage.setItem(getVoteStorageKey(userId), JSON.stringify(votes));
  } catch {
    // Ignore storage failures.
  }
};

async function fetchJson<T>(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

const getCaptionCountFromResponse = (response: unknown) => {
  if (Array.isArray(response)) return response.length;
  return 1;
};

export default function UploadCaptionsPage() {
  const params = useParams();
  const router = useRouter();
  const imageId = useMemo(() => params.imageId as string, [params.imageId]);

  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [image, setImage] = useState<ImageRow | null>(null);
  const [captions, setCaptions] = useState<CaptionRow[]>([]);
  const [votesByCaption, setVotesByCaption] = useState<Record<string, 1 | -1>>(
    {},
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [voteLoadMessage, setVoteLoadMessage] = useState<string | null>(null);
  const [isLoadingCaptions, setIsLoadingCaptions] = useState(false);
  const [isLoadingVotes, setIsLoadingVotes] = useState(false);
  const [isGeneratingMore, setIsGeneratingMore] = useState(false);

  useEffect(() => {
    let isMounted = true;

    supabaseClient.auth
      .getSession()
      .then(({ data }) => {
        if (!isMounted) return;
        if (data.session) {
          setCurrentUserId(data.session.user.id);
          setAuthStatus("signedIn");
        } else {
          setCurrentUserId(null);
          setAuthStatus("signedOut");
        }
      })
      .catch((error) => {
        if (!isMounted) return;
        setAuthStatus("signedOut");
        setErrorMessage(error.message);
      });

    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      if (session) {
        setCurrentUserId(session.user.id);
        setAuthStatus("signedIn");
      } else {
        setCurrentUserId(null);
        setAuthStatus("signedOut");
        setImage(null);
        setCaptions([]);
        setVotesByCaption({});
        setVoteLoadMessage(null);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: {
          prompt: "select_account",
        },
      },
    });
    if (error) {
      setErrorMessage(error.message);
    }
  };

  const handleSignOut = async () => {
    setErrorMessage(null);
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
      setErrorMessage(error.message);
    }
  };

  const loadImage = async (profileId: string, targetImageId: string) => {
    setErrorMessage(null);

    const { data, error } = await supabaseClient
      .from("images")
      .select("id, url, image_description")
      .eq("id", targetImageId)
      .eq("profile_id", profileId)
      .maybeSingle();

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setImage((data ?? null) as ImageRow | null);
  };

  const loadCaptionsForImage = async (targetImageId: string) => {
    setIsLoadingCaptions(true);
    setErrorMessage(null);

    const { data, error } = await supabaseClient
      .from("captions")
      .select("id, content, created_datetime_utc, like_count, image_id")
      .eq("image_id", targetImageId)
      .order("created_datetime_utc", { ascending: false });

    if (error) {
      setErrorMessage(error.message);
      setIsLoadingCaptions(false);
      return;
    }

    setCaptions((data ?? []) as CaptionRow[]);
    setIsLoadingCaptions(false);
  };

  useEffect(() => {
    if (authStatus !== "signedIn" || !currentUserId) return;
    void loadImage(currentUserId, imageId);
  }, [authStatus, currentUserId, imageId]);

  useEffect(() => {
    if (authStatus !== "signedIn") return;
    void loadCaptionsForImage(imageId);
  }, [authStatus, imageId]);

  useEffect(() => {
    if (authStatus !== "signedIn" || !currentUserId) return;
    setVotesByCaption(loadVotesFromStorage(currentUserId));
  }, [authStatus, currentUserId]);

  useEffect(() => {
    if (authStatus !== "signedIn" || !currentUserId) return;

    const loadVotes = async () => {
      setIsLoadingVotes(true);
      const {
        data: { user },
        error: userError,
      } = await supabaseClient.auth.getUser();

      if (userError || !user) {
        setVoteLoadMessage(
          `Could not load previous votes: ${userError?.message ?? "Not authenticated."}`,
        );
        setIsLoadingVotes(false);
        return;
      }

      const { data, error } = await supabaseClient
        .from("caption_votes")
        .select("caption_id, vote_value")
        .eq("profile_id", user.id);

      if (error) {
        setVoteLoadMessage(
          `Could not load previous votes from database: ${error.message}`,
        );
        setIsLoadingVotes(false);
        return;
      }

      const typedData = (data ?? []) as Array<{
        caption_id: string;
        vote_value: 1 | -1;
      }>;

      const nextVotes: Record<string, 1 | -1> = {};
      typedData.forEach((vote) => {
        nextVotes[vote.caption_id] = vote.vote_value;
      });

      setVotesByCaption((prev) => {
        const merged = { ...prev, ...nextVotes };
        saveVotesToStorage(currentUserId, merged);
        return merged;
      });
      setVoteLoadMessage(null);
      setIsLoadingVotes(false);
    };

    void loadVotes();
  }, [authStatus, currentUserId]);

  const handleVote = async (captionId: string, voteValue: 1 | -1) => {
    if (authStatus !== "signedIn") return;
    setErrorMessage(null);
    if (votesByCaption[captionId] === voteValue) return;

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();
    const sessionUserId = user?.id;

    if (userError || !sessionUserId) {
      setErrorMessage(
        userError?.message ?? "Your session expired. Please sign in again.",
      );
      return;
    }

    const now = new Date().toISOString();
    const { error: insertError } = await supabaseClient
      .from("caption_votes")
      .insert({
        caption_id: captionId,
        profile_id: sessionUserId,
        vote_value: voteValue,
        created_datetime_utc: now,
        modified_datetime_utc: now,
      });

    if (insertError && insertError.code !== "23505") {
      setErrorMessage(`Could not save vote: ${insertError.message}`);
      return;
    }

    if (insertError?.code === "23505") {
      const { error: updateError } = await supabaseClient
        .from("caption_votes")
        .update({ vote_value: voteValue, modified_datetime_utc: now })
        .eq("profile_id", sessionUserId)
        .eq("caption_id", captionId);

      if (updateError) {
        setErrorMessage(`Could not update vote: ${updateError.message}`);
        return;
      }
    }

    setVotesByCaption((prev) => {
      const merged = {
        ...prev,
        [captionId]: voteValue,
      };
      saveVotesToStorage(sessionUserId, merged);
      return merged;
    });
  };

  const handleGenerateMore = async () => {
    if (authStatus !== "signedIn") return;
    setErrorMessage(null);
    setIsGeneratingMore(true);
    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabaseClient.auth.getSession();

      if (sessionError || !session?.access_token) {
        throw new Error(
          sessionError?.message ?? "Your session expired. Please sign in again.",
        );
      }

      const baseUrl = "https://api.almostcrackd.ai";
      const responses: unknown[] = [];
      let totalGenerated = 0;
      let attempts = 0;
      const maxAttempts = 10;

      while (totalGenerated < 5 && attempts < maxAttempts) {
        const response = await fetchJson<unknown>(
          `${baseUrl}/pipeline/generate-captions`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ imageId }),
          },
        );
        responses.push(response);
        totalGenerated += getCaptionCountFromResponse(response);
        attempts += 1;
      }
      console.log(
        "generate-captions batch response",
        responses,
        "generated",
        totalGenerated,
        "attempts",
        attempts,
      );
      await loadCaptionsForImage(imageId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
    } finally {
      setIsGeneratingMore(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-12 text-zinc-950">
      <main className="mx-auto max-w-6xl">
        <TopNav authStatus={authStatus} onSignOut={handleSignOut} />

        <header className="mb-8 flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            Image Captions
          </h1>
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="inline-flex w-fit items-center justify-center rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
              onClick={() => router.push("/uploads")}
              type="button"
            >
              Back to uploads
            </button>
            <button
              className="inline-flex items-center justify-center rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleGenerateMore}
              type="button"
              disabled={isGeneratingMore || authStatus !== "signedIn"}
            >
              {isGeneratingMore ? "Generating..." : "Generate 5 more captions"}
            </button>
          </div>
        </header>

        {authStatus === "loading" && (
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-sm">
            Checking your session...
          </div>
        )}

        {authStatus === "signedOut" && (
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-zinc-600">
              You must sign in with Google to rate captions.
            </p>
            <button
              className="mt-4 inline-flex items-center justify-center rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
              onClick={handleGoogleSignIn}
              type="button"
            >
              Authenticate with Google
            </button>
            {errorMessage && (
              <p className="mt-3 text-sm text-red-600">{errorMessage}</p>
            )}
          </div>
        )}

        {authStatus === "signedIn" && errorMessage && (
          <div className="mb-6 rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Something went wrong</h2>
            <p className="mt-3 text-sm text-red-600">{errorMessage}</p>
          </div>
        )}

        {authStatus === "signedIn" && (
          <section>
            {voteLoadMessage && (
              <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                {voteLoadMessage}
              </div>
            )}

            {isLoadingCaptions && (
              <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-sm">
                Loading captions...
              </div>
            )}

            {!isLoadingCaptions && captions.length === 0 && (
              <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-10 text-center text-zinc-500">
                No captions available for this image yet.
              </div>
            )}

            {!isLoadingCaptions && captions.length > 0 && (
              <section className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {captions.map((caption) => {
                  const vote = votesByCaption[caption.id] ?? 0;
                  const isUpvoted = vote === 1;
                  const isDownvoted = vote === -1;

                  return (
                    <article
                      key={caption.id}
                      className="flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm"
                    >
                      <div className="aspect-[4/3] w-full overflow-hidden bg-zinc-100">
                        {image?.url ? (
                          <img
                            src={image.url}
                            alt={image.image_description ?? "Caption image"}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-sm text-zinc-400">
                            No image URL
                          </div>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col gap-3 p-5">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-zinc-400">
                            Caption
                          </p>
                          <p className="mt-1 text-base font-medium text-zinc-900">
                            {caption.content ?? "Untitled caption"}
                          </p>
                        </div>
                        <div className="mt-auto flex items-center gap-3">
                          <button
                            className={`inline-flex flex-1 items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-medium ${
                              isUpvoted
                                ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                                : "border-zinc-300 text-zinc-700 hover:bg-zinc-100"
                            }`}
                            onClick={() => handleVote(caption.id, 1)}
                            type="button"
                            aria-pressed={isUpvoted}
                          >
                            Upvote
                          </button>
                          <button
                            className={`inline-flex flex-1 items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-medium ${
                              isDownvoted
                                ? "border-rose-500 bg-rose-50 text-rose-700"
                                : "border-zinc-300 text-zinc-700 hover:bg-zinc-100"
                            }`}
                            onClick={() => handleVote(caption.id, -1)}
                            type="button"
                            aria-pressed={isDownvoted}
                          >
                            Downvote
                          </button>
                        </div>
                        {isLoadingVotes && (
                          <p className="text-xs text-zinc-400">
                            Loading your previous votes...
                          </p>
                        )}
                      </div>
                    </article>
                  );
                })}
              </section>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
