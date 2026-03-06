"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TopNav from "@/components/TopNav";
import { supabaseClient } from "@/lib/supabaseClient";
import type { Database } from "@/types/supabase";

type AuthStatus = "loading" | "signedOut" | "signedIn";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type CaptionRow = Database["public"]["Tables"]["captions"]["Row"];
type ImageRow = Database["public"]["Tables"]["images"]["Row"];

type CaptionWithImage = CaptionRow & {
  images: {
    id: string;
    url: string | null;
    image_description: string | null;
  } | null;
};

type AdminView = "users" | "captions" | "images";

const PAGE_SIZE = 50;

const allowedContentTypes = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
]);

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

const generateCaptionsBatch = async (
  token: string,
  imageId: string,
  targetCount = 5,
) => {
  const baseUrl = "https://api.almostcrackd.ai";
  const responses: unknown[] = [];
  let totalGenerated = 0;
  let attempts = 0;
  const maxAttempts = 10;

  while (totalGenerated < targetCount && attempts < maxAttempts) {
    const response = await fetchJson<unknown>(
      `${baseUrl}/pipeline/generate-captions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imageId }),
      },
    );
    responses.push(response);
    totalGenerated += getCaptionCountFromResponse(response);
    attempts += 1;
  }
  return responses;
};

export default function AdminPage() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [activeView, setActiveView] = useState<AdminView>("images");
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [captions, setCaptions] = useState<CaptionWithImage[]>([]);
  const [images, setImages] = useState<ImageRow[]>([]);
  const [profilePage, setProfilePage] = useState(0);
  const [captionPage, setCaptionPage] = useState(0);
  const [imagePage, setImagePage] = useState(0);
  const [hasMoreProfiles, setHasMoreProfiles] = useState(true);
  const [hasMoreCaptions, setHasMoreCaptions] = useState(true);
  const [hasMoreImages, setHasMoreImages] = useState(true);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(false);
  const [isLoadingCaptions, setIsLoadingCaptions] = useState(false);
  const [isLoadingImages, setIsLoadingImages] = useState(false);

  const [isUploading, setIsUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const [descriptionDrafts, setDescriptionDrafts] = useState<
    Record<string, string>
  >({});
  const [savingDescriptionId, setSavingDescriptionId] = useState<string | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
        setProfiles([]);
        setCaptions([]);
        setImages([]);
        setProfilePage(0);
        setCaptionPage(0);
        setImagePage(0);
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

  const canLoadAdminData = authStatus === "signedIn" && isSuperAdmin;

  const loadProfiles = useCallback(async () => {
    if (!canLoadAdminData || isLoadingProfiles || !hasMoreProfiles) return;
    setIsLoadingProfiles(true);
    setErrorMessage(null);

    const offset = profilePage * PAGE_SIZE;
    const { data, error } = await supabaseClient
      .from("profiles")
      .select(
        "id, first_name, last_name, email, is_superadmin, created_datetime_utc",
      )
      .order("created_datetime_utc", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      setErrorMessage(error.message);
      setIsLoadingProfiles(false);
      return;
    }

    const rows = (data ?? []) as ProfileRow[];
    setProfiles((prev) => [...prev, ...rows]);
    setProfilePage((prev) => prev + 1);
    setHasMoreProfiles(rows.length === PAGE_SIZE);
    setIsLoadingProfiles(false);
  }, [
    canLoadAdminData,
    hasMoreProfiles,
    isLoadingProfiles,
    profilePage,
  ]);

  const loadCaptions = useCallback(async () => {
    if (!canLoadAdminData || isLoadingCaptions || !hasMoreCaptions) return;
    setIsLoadingCaptions(true);
    setErrorMessage(null);

    const offset = captionPage * PAGE_SIZE;
    const { data, error } = await supabaseClient
      .from("captions")
      .select(
        "id, content, created_datetime_utc, like_count, image_id, images (id, url, image_description)",
      )
      .order("created_datetime_utc", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      setErrorMessage(error.message);
      setIsLoadingCaptions(false);
      return;
    }

    const rows = (data ?? []) as CaptionWithImage[];
    setCaptions((prev) => [...prev, ...rows]);
    setCaptionPage((prev) => prev + 1);
    setHasMoreCaptions(rows.length === PAGE_SIZE);
    setIsLoadingCaptions(false);
  }, [
    canLoadAdminData,
    captionPage,
    hasMoreCaptions,
    isLoadingCaptions,
  ]);

  const loadImages = useCallback(async (overridePage?: number) => {
    if (!canLoadAdminData || isLoadingImages) return;
    if (!hasMoreImages && overridePage === undefined) return;
    setIsLoadingImages(true);
    setErrorMessage(null);

    const pageToLoad = overridePage ?? imagePage;
    const offset = pageToLoad * PAGE_SIZE;
    const { data, error } = await supabaseClient
      .from("images")
      .select("id, url, image_description, created_datetime_utc, is_common_use")
      .order("created_datetime_utc", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      setErrorMessage(error.message);
      setIsLoadingImages(false);
      return;
    }

    const rows = (data ?? []) as ImageRow[];
    setImages((prev) => [...prev, ...rows]);
    setImagePage(pageToLoad + 1);
    setHasMoreImages(rows.length === PAGE_SIZE);
    setIsLoadingImages(false);
  }, [canLoadAdminData, hasMoreImages, imagePage, isLoadingImages]);

  useEffect(() => {
    if (!canLoadAdminData) return;
    if (activeView === "users" && profiles.length === 0) {
      void loadProfiles();
    }
    if (activeView === "captions" && captions.length === 0) {
      void loadCaptions();
    }
    if (activeView === "images" && images.length === 0) {
      void loadImages();
    }
  }, [
    activeView,
    canLoadAdminData,
    captions.length,
    images.length,
    loadCaptions,
    loadImages,
    loadProfiles,
    profiles.length,
  ]);

  const activeButtonStyles = useMemo(
    () =>
      "rounded-full border border-cyan-400/60 bg-cyan-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-cyan-100",
    [],
  );

  const inactiveButtonStyles = useMemo(
    () =>
      "rounded-full border border-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-zinc-500 transition hover:border-white/30 hover:text-zinc-200",
    [],
  );

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!allowedContentTypes.has(file.type)) {
      setErrorMessage(
        "Unsupported file type. Please upload a JPEG, JPG, PNG, WEBP, GIF, or HEIC image.",
      );
      event.target.value = "";
      return;
    }

    setIsUploading(true);
    setStatusMessage("Preparing upload...");
    setErrorMessage(null);

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

      const token = session.access_token;
      const baseUrl = "https://api.almostcrackd.ai";

      setStatusMessage("Requesting upload URL...");
      const presignResponse = await fetchJson<{
        presignedUrl: string;
        cdnUrl: string;
      }>(`${baseUrl}/pipeline/generate-presigned-url`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contentType: file.type,
        }),
      });

      setStatusMessage("Uploading image...");
      const uploadResponse = await fetch(presignResponse.presignedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
        },
        body: file,
      });

      if (!uploadResponse.ok) {
        const text = await uploadResponse.text();
        throw new Error(text || "Failed to upload image bytes.");
      }

      setStatusMessage("Registering image...");
      const registerResponse = await fetchJson<{
        imageId: string;
        now: number;
      }>(`${baseUrl}/pipeline/upload-image-from-url`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageUrl: presignResponse.cdnUrl,
          isCommonUse: false,
        }),
      });

      setStatusMessage("Generating captions...");
      await generateCaptionsBatch(token, registerResponse.imageId);

      setStatusMessage("Captions ready!");
      setImages([]);
      setImagePage(0);
      setHasMoreImages(true);
      if (activeView === "images") {
        await loadImages(0);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
      setStatusMessage(null);
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  const handleDeleteImage = async (imageId: string) => {
    if (!canLoadAdminData) return;
    setPendingDeleteId(imageId);
  };

  const confirmDeleteImage = async () => {
    if (!pendingDeleteId || !canLoadAdminData) return;

    setErrorMessage(null);
    setDeletingImageId(pendingDeleteId);
    const { error } = await supabaseClient
      .from("images")
      .delete()
      .eq("id", pendingDeleteId);
    if (error) {
      setErrorMessage(`Could not delete image: ${error.message}`);
      setDeletingImageId(null);
      setPendingDeleteId(null);
      return;
    }

    setImages((prev) => prev.filter((image) => image.id !== pendingDeleteId));
    setDeletingImageId(null);
    setPendingDeleteId(null);
  };

  const handleDescriptionChange = (imageId: string, value: string) => {
    setDescriptionDrafts((prev) => ({
      ...prev,
      [imageId]: value,
    }));
  };

  const handleSaveImageDescription = async (image: ImageRow) => {
    if (!canLoadAdminData || savingDescriptionId) return;
    setErrorMessage(null);
    setSavingDescriptionId(image.id);

    const draftValue =
      descriptionDrafts[image.id] ?? image.image_description ?? "";
    const cleanedDescription = draftValue.trim();
    const nextDescription = cleanedDescription.length
      ? cleanedDescription
      : null;

    const { error } = await supabaseClient
      .from("images")
      .update({ image_description: nextDescription })
      .eq("id", image.id);

    if (error) {
      setErrorMessage(`Could not update image description: ${error.message}`);
      setSavingDescriptionId(null);
      return;
    }

    setImages((prev) =>
      prev.map((entry) =>
        entry.id === image.id
          ? { ...entry, image_description: nextDescription }
          : entry,
      ),
    );
    setDescriptionDrafts((prev) => {
      const next = { ...prev };
      delete next[image.id];
      return next;
    });
    setSavingDescriptionId(null);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.12),_transparent_45%),_radial-gradient(circle_at_bottom,_rgba(192,132,252,0.12),_transparent_45%),_#0b0f17] px-6 py-10 text-zinc-100">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        <TopNav authStatus={authStatus} onSignOut={handleSignOut} />

        <header className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.4em] text-fuchsia-300/80">
            Admin Control
          </p>
          <h1 className="text-3xl font-semibold text-white sm:text-4xl">
            Manage users, captions, and images.
          </h1>
          <p className="max-w-2xl text-sm text-zinc-300">
            Superadmins only. Read profiles, inspect captions, and create or
            delete images directly.
          </p>
        </header>

        {errorMessage && (
          <p className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {errorMessage}
          </p>
        )}

        {authStatus === "loading" && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-300">
            Checking your session...
          </div>
        )}

        {authStatus === "signedOut" && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <p className="text-sm text-zinc-300">
              You must sign in with Google to access the admin console.
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

        {authStatus === "signedIn" && isSuperAdmin === false && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 text-sm text-rose-100">
            You are signed in but do not have superadmin access. Contact the
            project owner if this is unexpected.
          </div>
        )}

        {authStatus === "signedIn" && isSuperAdmin === null && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-300">
            Verifying superadmin access...
          </div>
        )}

        {canLoadAdminData && (
          <section className="rounded-[32px] border border-white/10 bg-gradient-to-br from-white/5 via-white/5 to-transparent p-6 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
            <div className="flex flex-wrap items-center gap-3">
              <button
                className={
                  activeView === "users"
                    ? activeButtonStyles
                    : inactiveButtonStyles
                }
                onClick={() => setActiveView("users")}
                type="button"
              >
                Users
              </button>
              <button
                className={
                  activeView === "captions"
                    ? activeButtonStyles
                    : inactiveButtonStyles
                }
                onClick={() => setActiveView("captions")}
                type="button"
              >
                Captions
              </button>
              <button
                className={
                  activeView === "images"
                    ? activeButtonStyles
                    : inactiveButtonStyles
                }
                onClick={() => setActiveView("images")}
                type="button"
              >
                Images
              </button>
            </div>

            {activeView === "users" && (
              <div className="mt-8">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-zinc-500">
                    Profiles
                  </h2>
                  {isLoadingProfiles && (
                    <span className="text-xs text-zinc-400">Loading...</span>
                  )}
                </div>
                {profiles.length === 0 && !isLoadingProfiles ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center text-zinc-400">
                    No profiles loaded yet.
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {profiles.map((profile) => (
                      <article
                        key={profile.id}
                        className="rounded-2xl border border-white/10 bg-[#0f1522] p-4 text-sm text-zinc-200 shadow-[0_20px_40px_rgba(0,0,0,0.35)]"
                      >
                        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                          {profile.is_superadmin ? "Superadmin" : "User"}
                        </p>
                        <h3 className="mt-2 text-base font-semibold text-white">
                          {[profile.first_name, profile.last_name]
                            .filter(Boolean)
                            .join(" ") || "Unnamed user"}
                        </h3>
                        <p className="mt-1 text-xs text-zinc-400">
                          {profile.email ?? "No email on file"}
                        </p>
                        <p className="mt-3 text-[11px] text-zinc-600">
                          {profile.id}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
                {hasMoreProfiles && (
                  <button
                    className="mt-6 inline-flex items-center justify-center rounded-full border border-white/15 px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-zinc-300 transition hover:border-white/40"
                    onClick={() => void loadProfiles()}
                    type="button"
                    disabled={isLoadingProfiles}
                  >
                    Load more
                  </button>
                )}
              </div>
            )}

            {activeView === "captions" && (
              <div className="mt-8">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-zinc-500">
                    Captions
                  </h2>
                  {isLoadingCaptions && (
                    <span className="text-xs text-zinc-400">Loading...</span>
                  )}
                </div>
                {captions.length === 0 && !isLoadingCaptions ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center text-zinc-400">
                    No captions loaded yet.
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {captions.map((caption) => (
                      <article
                        key={caption.id}
                        className="overflow-hidden rounded-2xl border border-white/10 bg-[#0f1522] shadow-[0_20px_40px_rgba(0,0,0,0.35)]"
                      >
                        <div className="relative aspect-[4/3] w-full overflow-hidden bg-black/40">
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
                                alt={
                                  caption.images.image_description ??
                                  "Caption image"
                                }
                                className="relative h-full w-full object-contain"
                              />
                            </>
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">
                              No image
                            </div>
                          )}
                        </div>
                        <div className="space-y-2 p-4 text-sm text-zinc-200">
                          <p className="max-h-16 overflow-hidden text-white">
                            {caption.content ?? "Untitled caption"}
                          </p>
                          <div className="flex items-center justify-between text-xs text-zinc-400">
                            <span>Likes: {caption.like_count ?? 0}</span>
                            <span>{caption.created_datetime_utc}</span>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                {hasMoreCaptions && (
                  <button
                    className="mt-6 inline-flex items-center justify-center rounded-full border border-white/15 px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-zinc-300 transition hover:border-white/40"
                    onClick={() => void loadCaptions()}
                    type="button"
                    disabled={isLoadingCaptions}
                  >
                    Load more
                  </button>
                )}
              </div>
            )}

            {activeView === "images" && (
              <div className="mt-8">
                <div className="mb-6 rounded-2xl border border-white/10 bg-[#0f1522] p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-white">
                        Upload a new image
                      </h2>
                      <p className="mt-1 text-sm text-zinc-400">
                        Supported types: JPEG, JPG, PNG, WEBP, GIF, HEIC.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,image/heic"
                        className="hidden"
                        onChange={handleFileChange}
                      />
                      <button
                        className="inline-flex items-center justify-center rounded-full border border-white/20 px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white/90 transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={handleUploadClick}
                        type="button"
                        disabled={isUploading}
                      >
                        {isUploading ? "Uploading..." : "Upload image"}
                      </button>
                    </div>
                  </div>
                  {statusMessage && (
                    <p className="mt-3 text-sm text-emerald-200">
                      {statusMessage}
                    </p>
                  )}
                </div>

                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-zinc-500">
                    Images
                  </h2>
                  {isLoadingImages && (
                    <span className="text-xs text-zinc-400">Loading...</span>
                  )}
                </div>
                {images.length === 0 && !isLoadingImages ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center text-zinc-400">
                    No images loaded yet.
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {images.map((image) => (
                      <article
                        key={image.id}
                        className="group overflow-hidden rounded-2xl border border-white/10 bg-[#0f1522] shadow-[0_20px_40px_rgba(0,0,0,0.35)]"
                      >
                        <div className="relative">
                          <div className="relative aspect-[4/3] w-full overflow-hidden bg-black/40">
                            {image.url ? (
                              <>
                                <div
                                  className="absolute inset-0 scale-110 blur-xl"
                                  style={{
                                    backgroundImage: `url(${image.url})`,
                                    backgroundSize: "cover",
                                    backgroundPosition: "center",
                                  }}
                                />
                                <img
                                  src={image.url}
                                  alt={image.image_description ?? "Uploaded image"}
                                  className="relative h-full w-full object-contain transition duration-200 group-hover:scale-[1.02]"
                                />
                              </>
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">
                                No image available
                              </div>
                            )}
                          </div>
                          <button
                            className="absolute right-3 top-3 inline-flex items-center justify-center rounded-full border border-rose-400/60 bg-rose-400/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-rose-100 shadow-sm transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={() => handleDeleteImage(image.id)}
                            type="button"
                            disabled={deletingImageId === image.id}
                          >
                            {deletingImageId === image.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                        <div className="p-4 text-xs text-zinc-400">
                          <label
                            htmlFor={`image-description-${image.id}`}
                            className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500"
                          >
                            Description
                          </label>
                          <input
                            id={`image-description-${image.id}`}
                            className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-400/60"
                            value={
                              descriptionDrafts[image.id] ??
                              image.image_description ??
                              ""
                            }
                            onChange={(event) =>
                              handleDescriptionChange(image.id, event.target.value)
                            }
                            placeholder="Untitled image"
                            disabled={savingDescriptionId === image.id}
                          />
                          <div className="mt-2 flex justify-end">
                            <button
                              className="inline-flex items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-400/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                              onClick={() => void handleSaveImageDescription(image)}
                              type="button"
                              disabled={savingDescriptionId === image.id}
                            >
                              {savingDescriptionId === image.id
                                ? "Saving..."
                                : "Save description"}
                            </button>
                          </div>
                          <p className="mt-2 text-[11px] text-zinc-600">
                            {image.id}
                          </p>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                {hasMoreImages && (
                  <button
                    className="mt-6 inline-flex items-center justify-center rounded-full border border-white/15 px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-zinc-300 transition hover:border-white/40"
                    onClick={() => void loadImages()}
                    type="button"
                    disabled={isLoadingImages}
                  >
                    Load more
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {pendingDeleteId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b0f17] p-6 shadow-[0_25px_60px_rgba(0,0,0,0.6)]">
              <h2 className="text-lg font-semibold text-white">
                Delete this image?
              </h2>
              <p className="mt-2 text-sm text-zinc-400">
                This will permanently remove the image and its captions.
              </p>
              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  className="inline-flex items-center justify-center rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-zinc-300 transition hover:border-white/40"
                  onClick={() => setPendingDeleteId(null)}
                  type="button"
                  disabled={deletingImageId === pendingDeleteId}
                >
                  Cancel
                </button>
                <button
                  className="inline-flex items-center justify-center rounded-full border border-rose-400/60 bg-rose-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-rose-100 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={confirmDeleteImage}
                  type="button"
                  disabled={deletingImageId === pendingDeleteId}
                >
                  {deletingImageId === pendingDeleteId
                    ? "Deleting..."
                    : "Delete"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
