"use client";

import { useEffect, useState } from "react";
import { supabaseClient } from "@/lib/supabaseClient";
import type { Database } from "@/types/supabase";

type AuthStatus = "loading" | "signedOut" | "signedIn";

type CaptionRow = Database["public"]["Tables"]["captions"]["Row"];

type CaptionWithImage = CaptionRow & {
  images: {
    id: string;
    url: string | null;
    image_description: string | null;
  } | null;
};

const PAGE_SIZE = 50;
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

export default function Home() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [captions, setCaptions] = useState<CaptionWithImage[]>([]);
  const [votesByCaption, setVotesByCaption] = useState<Record<string, 1 | -1>>(
    {},
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [voteLoadMessage, setVoteLoadMessage] = useState<string | null>(null);
  const [isLoadingCaptions, setIsLoadingCaptions] = useState(false);
  const [isLoadingVotes, setIsLoadingVotes] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

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
        setVoteLoadMessage(null);
        setAuthStatus("signedOut");
        setCaptions([]);
        setVotesByCaption({});
        setPage(1);
        setHasMore(true);
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

  const loadCaptions = async (nextPage: number, reset = false) => {
    setIsLoadingCaptions(true);
    setErrorMessage(null);
    const start = (nextPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE - 1;
    const { data, error } = await supabaseClient
      .from("captions")
      .select(
        "id, content, created_datetime_utc, image_id, images!inner ( id, url, image_description )",
      )
      .order("like_count", { ascending: false })
      .eq("is_public", true)
      .not("images.url", "is", null)
      .range(start, end);

    if (error) {
      setErrorMessage(error.message);
      setIsLoadingCaptions(false);
      return;
    }

    const fetched = (data ?? []) as CaptionWithImage[];
    setCaptions((prev) => (reset ? fetched : [...prev, ...fetched]));
    setHasMore(fetched.length === PAGE_SIZE);
    setIsLoadingCaptions(false);
  };

  useEffect(() => {
    if (authStatus !== "signedIn") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCaptions(1, true);
  }, [authStatus]);

  useEffect(() => {
    if (authStatus !== "signedIn" || !currentUserId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-12 text-zinc-950">
      <main className="mx-auto max-w-6xl">
        <header className="mb-10 flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="text-3xl font-semibold tracking-tight">
              Caption Ratings
            </h1>
            {authStatus === "signedIn" && (
              <div className="flex items-center gap-2">
                <button
                  className="inline-flex items-center justify-center rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
                  onClick={handleSignOut}
                  type="button"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
          {authStatus === "signedIn" && (
            <div className="text-sm text-zinc-600">
              {isLoadingCaptions ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
                  Loading captions...
                </span>
              ) : (
                <span>
                  {captions.length} caption
                  {captions.length === 1 ? "" : "s"} loaded.
                </span>
              )}
            </div>
          )}
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

        {authStatus === "signedIn" && isLoadingCaptions && (
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-sm">
            Loading captions...
          </div>
        )}

        {authStatus === "signedIn" && errorMessage && !isLoadingCaptions && (
          <div className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Something went wrong</h2>
            <p className="mt-3 text-sm text-red-600">{errorMessage}</p>
          </div>
        )}

        {authStatus === "signedIn" && voteLoadMessage && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            {voteLoadMessage}
          </div>
        )}

        {authStatus === "signedIn" &&
        !isLoadingCaptions &&
        !errorMessage &&
        captions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-10 text-center text-zinc-500">
            No captions available yet.
          </div>
        ) : (
          authStatus === "signedIn" && (
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
                      {caption.images?.url ? (
                        <img
                          src={caption.images.url}
                          alt={caption.images.image_description ?? "Caption image"}
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
          )
        )}

        {authStatus === "signedIn" && captions.length > 0 && (
          <div className="mt-10 flex justify-center">
            <button
              className="inline-flex items-center justify-center rounded-full border border-zinc-300 px-6 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => {
                const nextPage = page + 1;
                setPage(nextPage);
                void loadCaptions(nextPage);
              }}
              type="button"
              disabled={!hasMore || isLoadingCaptions}
            >
              {hasMore ? "Load more captions" : "No more captions"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
