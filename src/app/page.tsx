"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseClient } from "@/lib/supabaseClient";
import type { Database } from "@/types/supabase";
import TopNav from "@/components/TopNav";

type AuthStatus = "loading" | "signedOut" | "signedIn";

type CaptionRow = Database["public"]["Tables"]["captions"]["Row"];

type CaptionWithImage = CaptionRow & {
  images: {
    id: string;
    url: string | null;
    image_description: string | null;
  } | null;
};

type CaptionFilter =
  | "popular_all"
  | "popular_month"
  | "popular_week"
  | "recent"
  | "hot";

const PAGE_SIZE = 50;
const VOTE_STORAGE_KEY_PREFIX = "caption_votes_by_user";
const FILTER_STORAGE_KEY = "caption_filter_selection";

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

const toUtcIso = (date: Date) => date.toISOString();

const getUtcThirtyDaysAgo = (date: Date) =>
  new Date(date.getTime() - 30 * 24 * 60 * 60 * 1000);

const getUtcSevenDaysAgo = (date: Date) =>
  new Date(date.getTime() - 7 * 24 * 60 * 60 * 1000);

export default function Home() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [captions, setCaptions] = useState<CaptionWithImage[]>([]);
  const [filter, setFilter] = useState<CaptionFilter>("popular_week");
  const [lastPopularFilter, setLastPopularFilter] =
    useState<CaptionFilter>("popular_week");
  const [votesByCaption, setVotesByCaption] = useState<Record<string, 1 | -1>>(
    {},
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [voteLoadMessage, setVoteLoadMessage] = useState<string | null>(null);
  const [isLoadingCaptions, setIsLoadingCaptions] = useState(false);
  const [isLoadingVotes, setIsLoadingVotes] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [popularMenuOpen, setPopularMenuOpen] = useState(false);
  const popularMenuRef = useRef<HTMLDivElement | null>(null);
  const popularLabel =
    filter === "popular_week"
      ? "Last 7 days"
      : filter === "popular_month"
        ? "Last 30 days"
        : "All time";

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

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(FILTER_STORAGE_KEY);
      if (
        stored === "popular_all" ||
        stored === "popular_month" ||
        stored === "popular_week" ||
        stored === "recent" ||
        stored === "hot"
      ) {
        setFilter(stored);
        if (
          stored === "popular_all" ||
          stored === "popular_month" ||
          stored === "popular_week"
        ) {
          setLastPopularFilter(stored);
        }
      }
    } catch {
      // Ignore storage failures.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, filter);
    } catch {
      // Ignore storage failures.
    }
  }, [filter]);

  useEffect(() => {
    if (
      filter === "popular_all" ||
      filter === "popular_month" ||
      filter === "popular_week"
    ) {
      setLastPopularFilter(filter);
    }
  }, [filter]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popularMenuRef.current &&
        !popularMenuRef.current.contains(event.target as Node)
      ) {
        setPopularMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
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
    const now = new Date();
    const weekStart = getUtcSevenDaysAgo(now);
    const monthStart = getUtcThirtyDaysAgo(now);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    if (filter === "hot") {
      const { data: recentVotes, error: voteError } = await supabaseClient
        .from("caption_votes")
        .select("caption_id")
        .eq("vote_value", 1)
        .gte("created_datetime_utc", toUtcIso(oneDayAgo));

      if (voteError) {
        setErrorMessage(voteError.message);
        setIsLoadingCaptions(false);
        return;
      }

      const uniqueIds = Array.from(
        new Set((recentVotes ?? []).map((vote) => vote.caption_id)),
      );

      if (uniqueIds.length === 0) {
        if (reset) {
          setCaptions([]);
        }
        setHasMore(false);
        setIsLoadingCaptions(false);
        return;
      }

      const { data, error } = await supabaseClient
        .from("captions")
        .select(
          "id, content, created_datetime_utc, image_id, images!inner ( id, url, image_description )",
        )
        .not("content", "is", null)
        .not("images.url", "is", null)
        .gte("created_datetime_utc", toUtcIso(threeDaysAgo))
        .in("id", uniqueIds)
        .order("like_count", { ascending: false })
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
      return;
    }

    let query = supabaseClient
      .from("captions")
      .select(
        "id, content, created_datetime_utc, image_id, images!inner ( id, url, image_description )",
      )
      .not("content", "is", null)
      .not("images.url", "is", null);

    if (filter === "popular_month") {
      query = query.gte("created_datetime_utc", toUtcIso(monthStart));
    }

    if (filter === "popular_week") {
      query = query.gte("created_datetime_utc", toUtcIso(weekStart));
    }

    if (filter === "recent") {
      query = query.order("created_datetime_utc", { ascending: false });
    } else {
      query = query.order("like_count", { ascending: false });
    }

    const { data, error } = await query.range(start, end);

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
  }, [authStatus, filter]);

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
        <TopNav authStatus={authStatus} onSignOut={handleSignOut} />

        <header className="mb-8 flex flex-col gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              All Captions
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-600">
              <div className="relative" ref={popularMenuRef}>
                <div
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 ${
                    filter.startsWith("popular")
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-zinc-300 text-zinc-700 hover:bg-zinc-100"
                  }`}
                >
                  <button
                    className="text-sm font-medium"
                    onClick={() => {
                      setFilter(lastPopularFilter);
                      setPage(1);
                      setHasMore(true);
                      setCaptions([]);
                    }}
                    type="button"
                  >
                    Most popular
                    {filter.startsWith("popular") ? ` · ${popularLabel}` : ""}
                  </button>
                  <button
                    className="cursor-pointer text-sm leading-none text-zinc-500 hover:text-zinc-800"
                    onClick={(event) => {
                      event.stopPropagation();
                      setPopularMenuOpen((prev) => !prev);
                    }}
                    type="button"
                    aria-expanded={popularMenuOpen}
                    aria-haspopup="menu"
                  >
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.25a.75.75 0 0 1-1.06 0L5.25 8.29a.75.75 0 0 1-.02-1.08Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
                {popularMenuOpen && (
                  <div className="absolute left-0 z-10 mt-2 w-40 rounded-xl border border-zinc-200 bg-white p-2 text-sm text-zinc-700 shadow-lg">
                    <button
                      className={`w-full cursor-pointer rounded-lg px-3 py-2 text-left hover:bg-zinc-100 ${
                        filter === "popular_all" ? "text-blue-700" : ""
                      }`}
                      onClick={() => {
                        setFilter("popular_all");
                        setPage(1);
                        setHasMore(true);
                        setCaptions([]);
                        setPopularMenuOpen(false);
                      }}
                      type="button"
                    >
                      All time
                    </button>
                    <button
                      className={`w-full cursor-pointer rounded-lg px-3 py-2 text-left hover:bg-zinc-100 ${
                        filter === "popular_month" ? "text-blue-700" : ""
                      }`}
                      onClick={() => {
                        setFilter("popular_month");
                        setPage(1);
                        setHasMore(true);
                        setCaptions([]);
                        setPopularMenuOpen(false);
                      }}
                      type="button"
                    >
                      This month
                    </button>
                    <button
                      className={`w-full cursor-pointer rounded-lg px-3 py-2 text-left hover:bg-zinc-100 ${
                        filter === "popular_week" ? "text-blue-700" : ""
                      }`}
                      onClick={() => {
                        setFilter("popular_week");
                        setPage(1);
                        setHasMore(true);
                        setCaptions([]);
                        setPopularMenuOpen(false);
                      }}
                      type="button"
                    >
                      This week
                    </button>
                  </div>
                )}
              </div>
              <button
                className={`rounded-full border px-4 py-2 ${
                  filter === "recent"
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-zinc-300 text-zinc-700 hover:bg-zinc-100"
                }`}
                onClick={() => {
                  setFilter("recent");
                  setPage(1);
                  setHasMore(true);
                  setCaptions([]);
                }}
                type="button"
              >
                Most recent
              </button>
              <button
                className={`rounded-full border px-4 py-2 ${
                  filter === "hot"
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-zinc-300 text-zinc-700 hover:bg-zinc-100"
                }`}
                onClick={() => {
                  setFilter("hot");
                  setPage(1);
                  setHasMore(true);
                  setCaptions([]);
                }}
                type="button"
              >
                Hot
              </button>
            </div>
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
                    <div className="relative aspect-[4/3] w-full overflow-hidden bg-zinc-50">
                      {caption.images?.url ? (
                        <>
                          <div
                            className="absolute inset-0 scale-110 blur-xl"
                            style={{
                              backgroundImage: `url(${caption.images.url})`,
                              backgroundSize: "cover",
                              backgroundPosition: "center",
                            }}
                          />
                          <img
                            src={caption.images.url}
                            alt={caption.images.image_description ?? "Caption image"}
                            className="relative h-full w-full object-contain"
                            loading="lazy"
                          />
                        </>
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
