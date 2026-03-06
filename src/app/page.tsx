"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TopNav from "@/components/TopNav";
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

type ImageStat = {
  imageId: string;
  url: string | null;
  imageDescription: string | null;
  captionCount: number;
  totalLikes: number;
};

type HoveredPoint = {
  point: ImageStat;
  x: number;
  y: number;
};

type DataMode = "fast" | "full";

const PAGE_LIMIT = 1000;
const MIN_TOTAL_LIKES = 25;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export default function Home() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null);
  const [stats, setStats] = useState<ImageStat[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<HoveredPoint | null>(null);
  const [dataMode, setDataMode] = useState<DataMode>("fast");
  const [authWarning, setAuthWarning] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [chartSize, setChartSize] = useState({ width: 900, height: 560 });

  useEffect(() => {
    const authParam = new URLSearchParams(window.location.search).get("auth");
    if (authParam === "not_superadmin") {
      setAuthWarning("You are not a superadmin, so admin access was denied.");
      return;
    }
    setAuthWarning(null);
  }, []);

  useEffect(() => {
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect) {
          setChartSize({
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          });
        }
      }
    });

    if (chartRef.current) {
      resizeObserver.observe(chartRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const resolveSession = async () => {
      const { data, error } = await supabaseClient.auth.getSession();
      if (!isMounted) return;
      if (error) {
        setAuthStatus("signedOut");
        setErrorMessage(error.message);
        return;
      }
      if (data.session) {
        setCurrentUserId(data.session.user.id);
        setAuthStatus("signedIn");
      } else {
        setCurrentUserId(null);
        setAuthStatus("signedOut");
        setIsSuperAdmin(null);
      }
    };

    void resolveSession();

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
        setIsSuperAdmin(null);
        setStats([]);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const checkSuperAdmin = useCallback(async (userId: string) => {
    setErrorMessage(null);
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("id, is_superadmin")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      setErrorMessage(error.message);
      setIsSuperAdmin(false);
      return false;
    }

    if (!data?.is_superadmin) {
      setIsSuperAdmin(false);
      await supabaseClient.auth.signOut();
      return false;
    }

    setIsSuperAdmin(true);
    return true;
  }, []);

  useEffect(() => {
    if (authStatus !== "signedIn" || !currentUserId) return;
    void checkSuperAdmin(currentUserId);
  }, [authStatus, checkSuperAdmin, currentUserId]);

  useEffect(() => {
    let isMounted = true;

    const loadStats = async () => {
      if (authStatus !== "signedIn" || !isSuperAdmin) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setErrorMessage(null);
      setStats([]);

      try {
        const statsMap = new Map<string, ImageStat>();
        let offset = 0;
        let keepLoading = true;
        let safetyCounter = 0;

        while (keepLoading) {
          let query = supabaseClient
            .from("captions")
            .select("image_id, like_count, images (id, url, image_description)")
            .range(offset, offset + PAGE_LIMIT - 1);

          if (dataMode === "fast") {
            query = query.gt("like_count", 0);
          }

          const { data, error } = await query;

          if (error) {
            throw error;
          }

          const rows = (data ?? []) as CaptionWithImage[];
          if (rows.length < PAGE_LIMIT) {
            keepLoading = false;
          }

          rows.forEach((row) => {
            if (!row.image_id) return;
            const existing = statsMap.get(row.image_id);
            const likeCount = row.like_count ?? 0;
            const url = row.images?.url ?? null;
            const imageDescription = row.images?.image_description ?? null;

            if (!existing) {
              if (!url || url.trim().length === 0) return;
              statsMap.set(row.image_id, {
                imageId: row.image_id,
                url,
                imageDescription,
                captionCount: 1,
                totalLikes: likeCount,
              });
            } else {
              existing.captionCount += 1;
              existing.totalLikes += likeCount;
              if (!existing.url && url) {
                existing.url = url;
              }
              if (!existing.imageDescription && imageDescription) {
                existing.imageDescription = imageDescription;
              }
            }
          });

          offset += PAGE_LIMIT;
          safetyCounter += 1;
          if (safetyCounter > 200) {
            keepLoading = false;
          }
        }

        if (isMounted) {
          const filtered = Array.from(statsMap.values())
            .filter(
              (item) =>
                item.totalLikes > MIN_TOTAL_LIKES &&
                item.url &&
                item.url.trim().length > 0 &&
                item.url.startsWith("http") &&
                item.url !==
                  "https://images.almostcrackd.ai/ac4211e5-78e0-4967-ab1e-2b539dc13ac2/002102c1-9ab6-4688-ae1a-99aeced0c063.jpg",
            )
            .sort((a, b) => b.totalLikes - a.totalLikes);
          setStats(filtered);
        }
      } catch (error) {
        if (!isMounted) return;
        const message = error instanceof Error ? error.message : String(error);
        setErrorMessage(message);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadStats();

    return () => {
      isMounted = false;
    };
  }, [authStatus, currentUserId, dataMode, isSuperAdmin]);

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

  const chartMetrics = useMemo(() => {
    const padding = { top: 40, right: 40, bottom: 70, left: 90 };
    const maxCaptionCount = Math.max(
      10,
      ...stats.map((item) => item.captionCount),
    );
    const maxLikes = Math.max(25, ...stats.map((item) => item.totalLikes));

    return { padding, maxCaptionCount, maxLikes };
  }, [stats]);

  const handlePointMove = (
    event:
      | React.MouseEvent<HTMLButtonElement>
      | React.FocusEvent<HTMLButtonElement>,
    point: ImageStat,
  ) => {
    const bounds = chartRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const hasMouseCoords = "clientX" in event && "clientY" in event;
    const fallbackBounds = event.currentTarget.getBoundingClientRect();
    const rawX = hasMouseCoords
      ? event.clientX
      : fallbackBounds.left + fallbackBounds.width / 2;
    const rawY = hasMouseCoords
      ? event.clientY
      : fallbackBounds.top + fallbackBounds.height / 2;
    const x = clamp(rawX - bounds.left, 0, bounds.width);
    const y = clamp(rawY - bounds.top, 0, bounds.height);
    setHoveredPoint({ point, x, y });
  };

  const handlePointLeave = () => {
    setHoveredPoint(null);
  };

  const scaleX = (value: number) => {
    const { padding } = chartMetrics;
    const width = Math.max(1, chartSize.width - padding.left - padding.right);
    return padding.left + (value / chartMetrics.maxCaptionCount) * width;
  };

  const scaleY = (value: number) => {
    const { padding } = chartMetrics;
    const height = Math.max(1, chartSize.height - padding.top - padding.bottom);
    return (
      padding.top +
      (1 - value / chartMetrics.maxLikes) * height
    );
  };

  const gridLines = 5;
  const xSteps = Array.from({ length: gridLines + 1 }, (_, index) => index);
  const ySteps = Array.from({ length: gridLines + 1 }, (_, index) => index);
  const canLoadData = authStatus === "signedIn" && isSuperAdmin;
  const safeWidth = Math.max(1, chartSize.width);
  const safeHeight = Math.max(1, chartSize.height);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.12),_transparent_45%),_radial-gradient(circle_at_bottom,_rgba(192,132,252,0.12),_transparent_45%),_#0b0f17] px-6 py-10 text-zinc-100">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        <TopNav authStatus={authStatus} onSignOut={handleSignOut} />

        <header className="flex flex-col gap-4">
          <p className="text-xs font-semibold uppercase tracking-[0.4em] text-cyan-300/80">
            Caption Intelligence
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Do the funniest images outperform the captions?
          </h1>
          <p className="max-w-2xl text-sm text-zinc-300">
            Each bubble is an image. The further right, the more captions
            reference it. The higher it climbs, the more likes those captions
            earn in total. Hover a point to inspect the image and its precise
            totals. Only images with more than {MIN_TOTAL_LIKES} cumulative likes
            are shown.
          </p>
          <div className="max-w-3xl rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-300">
            {dataMode === "fast" ? (
              <p>
                Fast mode is active. This chart only includes captions with at
                least 1 like, so points load faster but caption usage counts
                reflect liked captions only.
              </p>
            ) : (
              <p>
                Full mode is active. This chart includes all captions (including
                zero-like captions), so caption usage counts are complete but
                loading can take significantly longer.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              className={`inline-flex items-center justify-center rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                dataMode === "fast"
                  ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-100"
                  : "border-white/15 text-zinc-300 hover:border-white/40"
              }`}
              onClick={() => setDataMode("fast")}
              type="button"
              disabled={isLoading}
            >
              Fast Data
            </button>
            <button
              className={`inline-flex items-center justify-center rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                dataMode === "full"
                  ? "border-amber-400/60 bg-amber-400/10 text-amber-100"
                  : "border-amber-500/40 text-amber-100 hover:border-amber-400/70"
              }`}
              onClick={() => setDataMode("full")}
              type="button"
              disabled={isLoading || dataMode === "full"}
            >
              Load Full Data
            </button>
            {dataMode !== "full" && (
              <span className="text-xs text-amber-200/80">
                Warning: full data can take a long time to load.
              </span>
            )}
          </div>
          {authWarning && (
            <p className="rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
              {authWarning}
            </p>
          )}
          {errorMessage && (
            <p className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {errorMessage}
            </p>
          )}
        </header>

        {authStatus === "loading" && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-300">
            Checking your session...
          </div>
        )}

        {authStatus === "signedOut" && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <p className="text-sm text-zinc-300">
              Sign in with Google to view the data visualization.
            </p>
            <button
              className="mt-4 inline-flex items-center justify-center rounded-full border border-white/20 px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white/90 transition hover:border-white/40"
              onClick={handleGoogleSignIn}
              type="button"
            >
              Authenticate with Google
            </button>
          </div>
        )}

        {authStatus === "signedIn" && isSuperAdmin === null && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-300">
            Verifying superadmin access...
          </div>
        )}

        {authStatus === "signedIn" && isSuperAdmin === false && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 text-sm text-rose-100">
            You are signed in but do not have superadmin access. Contact the
            project owner if this is unexpected.
          </div>
        )}

        {canLoadData && (
          <section className="rounded-[32px] border border-white/10 bg-gradient-to-br from-white/5 via-white/5 to-transparent p-6 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
          <div className="flex items-center justify-between gap-4 pb-4">
            <div>
              <h2 className="text-lg font-semibold text-white">
                Image Popularity vs Likes
              </h2>
              <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                {stats.length} images • {isLoading ? "Loading..." : "Ready"}
              </p>
            </div>
          </div>

          <div
            ref={chartRef}
            className="relative h-[560px] w-full overflow-visible rounded-3xl border border-white/10 bg-[#0f1522]"
          >
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox={`0 0 ${chartSize.width} ${chartSize.height}`}
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="gridFade" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.05)" />
                  <stop offset="100%" stopColor="rgba(255,255,255,0.01)" />
                </linearGradient>
              </defs>
              {xSteps.map((step) => {
                const x =
                  chartMetrics.padding.left +
                  (step / gridLines) *
                    (chartSize.width -
                      chartMetrics.padding.left -
                      chartMetrics.padding.right);
                return (
                  <line
                    key={`x-${step}`}
                    x1={x}
                    y1={chartMetrics.padding.top}
                    x2={x}
                    y2={chartSize.height - chartMetrics.padding.bottom}
                    stroke="url(#gridFade)"
                    strokeWidth="1"
                  />
                );
              })}
              {ySteps.map((step) => {
                const y =
                  chartMetrics.padding.top +
                  (step / gridLines) *
                    (chartSize.height -
                      chartMetrics.padding.top -
                      chartMetrics.padding.bottom);
                return (
                  <line
                    key={`y-${step}`}
                    x1={chartMetrics.padding.left}
                    y1={y}
                    x2={chartSize.width - chartMetrics.padding.right}
                    y2={y}
                    stroke="url(#gridFade)"
                    strokeWidth="1"
                  />
                );
              })}
              <line
                x1={chartMetrics.padding.left}
                y1={chartMetrics.padding.top}
                x2={chartMetrics.padding.left}
                y2={chartSize.height - chartMetrics.padding.bottom}
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="2"
              />
              <line
                x1={chartMetrics.padding.left}
                y1={chartSize.height - chartMetrics.padding.bottom}
                x2={chartSize.width - chartMetrics.padding.right}
                y2={chartSize.height - chartMetrics.padding.bottom}
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="2"
              />
              <text
                x={chartMetrics.padding.left}
                y={chartMetrics.padding.top - 12}
                fill="rgba(255,255,255,0.5)"
                fontSize="12"
              >
                Total Likes
              </text>
              <text
                x={chartSize.width - chartMetrics.padding.right}
                y={chartSize.height - chartMetrics.padding.bottom + 36}
                fill="rgba(255,255,255,0.5)"
                fontSize="12"
                textAnchor="end"
              >
                Caption Usage Count
              </text>
            </svg>

            {!isLoading &&
              stats.map((point) => {
                const x = scaleX(point.captionCount);
                const y = scaleY(point.totalLikes);
                return (
                  <button
                    key={point.imageId}
                    className="group absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20 bg-white/5 p-0.5 shadow-[0_0_18px_rgba(56,189,248,0.35)] transition hover:scale-110"
                    style={{ left: x, top: y }}
                    onMouseEnter={(event) => handlePointMove(event, point)}
                    onMouseMove={(event) => handlePointMove(event, point)}
                    onMouseLeave={handlePointLeave}
                    onFocus={(event) => handlePointMove(event, point)}
                    onBlur={handlePointLeave}
                    type="button"
                  >
                    <span
                      className="block h-7 w-7 rounded-full bg-cover bg-center"
                      style={{ backgroundImage: `url(${point.url ?? ""})` }}
                    />
                  </button>
                );
              })}

            {hoveredPoint && safeWidth > 1 && safeHeight > 1 && (
              <div
                className="pointer-events-none absolute z-20 w-64 rounded-2xl border border-white/15 bg-[#0b0f17]/95 p-3 shadow-[0_25px_60px_rgba(0,0,0,0.6)] backdrop-blur"
                style={{
                  left: clamp(
                    (Number.isFinite(hoveredPoint.x)
                      ? hoveredPoint.x
                      : 0) + 24,
                    16,
                    safeWidth - 280,
                  ),
                  top: clamp(
                    (Number.isFinite(hoveredPoint.y)
                      ? hoveredPoint.y
                      : 0) + 24,
                    16,
                    safeHeight - 240,
                  ),
                }}
              >
                <div className="relative mb-3 aspect-[4/3] w-full overflow-hidden rounded-xl border border-white/10 bg-black/40">
                  <div
                    className="absolute inset-0 scale-110 blur-xl"
                    style={{
                      backgroundImage: `url(${hoveredPoint.point.url ?? ""})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  />
                  <img
                    src={hoveredPoint.point.url ?? ""}
                    alt={hoveredPoint.point.imageDescription ?? "Caption image"}
                    className="relative h-full w-full object-contain"
                  />
                </div>
                <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                  Image Insights
                </div>
                <div className="mt-2 text-sm text-white">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400">Total likes</span>
                    <span className="font-semibold">
                      {hoveredPoint.point.totalLikes}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-zinc-400">Caption uses</span>
                    <span className="font-semibold">
                      {hoveredPoint.point.captionCount}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {isLoading && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 text-sm text-zinc-300">
                <div className="w-2/3 max-w-sm overflow-hidden rounded-full border border-white/10 bg-white/5">
                  <div className="h-2 w-1/2 animate-pulse rounded-full bg-gradient-to-r from-cyan-400/70 via-sky-400/60 to-fuchsia-400/60" />
                </div>
                <span className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                  Building chart data...
                </span>
              </div>
            )}
          </div>
        </section>
        )}
      </main>
    </div>
  );
}
