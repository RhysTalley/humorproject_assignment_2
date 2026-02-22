"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabaseClient } from "@/lib/supabaseClient";
import type { Database } from "@/types/supabase";
import TopNav from "@/components/TopNav";

type AuthStatus = "loading" | "signedOut" | "signedIn";

type ImageRow = Database["public"]["Tables"]["images"]["Row"];

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
  console.log(
    "generate-captions batch response",
    responses,
    "generated",
    totalGenerated,
    "attempts",
    attempts,
  );
  return responses;
};

export default function UploadsPage() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [images, setImages] = useState<ImageRow[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
        setImages([]);
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

  const loadImages = async (profileId: string) => {
    setIsLoadingImages(true);
    setErrorMessage(null);

    const { data, error } = await supabaseClient
      .from("images")
      .select("id, url, image_description, created_datetime_utc, is_common_use")
      .eq("profile_id", profileId)
      .order("created_datetime_utc", { ascending: false });

    if (error) {
      setErrorMessage(error.message);
      setIsLoadingImages(false);
      return;
    }

    const fetched = (data ?? []) as ImageRow[];
    setImages(fetched);
    setIsLoadingImages(false);
  };

  useEffect(() => {
    if (authStatus !== "signedIn" || !currentUserId) return;
    void loadImages(currentUserId);
  }, [authStatus, currentUserId]);

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
      if (currentUserId) {
        await loadImages(currentUserId);
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
    if (authStatus !== "signedIn") return;
    setPendingDeleteId(imageId);
  };

  const confirmDeleteImage = async () => {
    if (!pendingDeleteId || authStatus !== "signedIn") return;

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

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-12 text-zinc-950">
      <main className="mx-auto max-w-6xl">
        <TopNav authStatus={authStatus} onSignOut={handleSignOut} />

        <header className="mb-8 flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            Your Uploads
          </h1>
          <p className="text-sm text-zinc-600">
            Upload an image, generate captions, and rate them.
          </p>
        </header>

        {authStatus === "loading" && (
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-sm">
            Checking your session...
          </div>
        )}

        {authStatus === "signedOut" && (
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-zinc-600">
              You must sign in with Google to manage your uploads.
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

        {authStatus === "signedIn" && (
          <section className="mb-8 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Upload a new image</h2>
                <p className="mt-1 text-sm text-zinc-600">
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
                  className="inline-flex items-center justify-center rounded-full border border-zinc-300 px-5 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handleUploadClick}
                  type="button"
                  disabled={isUploading}
                >
                  {isUploading ? "Uploading..." : "Upload image"}
                </button>
              </div>
            </div>
            {statusMessage && (
              <p className="mt-3 text-sm text-emerald-700">{statusMessage}</p>
            )}
            {errorMessage && (
              <p className="mt-3 text-sm text-red-600">{errorMessage}</p>
            )}
          </section>
        )}

        {authStatus === "signedIn" && (
          <section>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                Your Images
              </h2>
              {isLoadingImages && (
                <span className="text-xs text-zinc-400">Loading...</span>
              )}
            </div>
            {images.length === 0 && !isLoadingImages ? (
              <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-10 text-center text-zinc-500 shadow-sm">
                You have not uploaded any images yet.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {images.map((image) => (
                  <article
                    key={image.id}
                    className="group overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-md"
                  >
                    <div className="relative">
                      <Link href={`/uploads/${image.id}`} className="block">
                        <div className="aspect-[4/3] w-full overflow-hidden bg-zinc-100">
                          {image.url ? (
                            <img
                              src={image.url}
                              alt="Uploaded image"
                              className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-sm text-zinc-400">
                              No image available
                            </div>
                          )}
                        </div>
                      </Link>
                      <button
                        className="absolute right-3 top-3 inline-flex items-center justify-center rounded-full border border-rose-300 bg-white/90 px-3 py-1.5 text-xs font-semibold text-rose-700 shadow-sm hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => handleDeleteImage(image.id)}
                        type="button"
                        disabled={deletingImageId === image.id}
                      >
                        {deletingImageId === image.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {pendingDeleteId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl">
              <h2 className="text-lg font-semibold text-zinc-900">
                Delete this image?
              </h2>
              <p className="mt-2 text-sm text-zinc-600">
                This will permanently remove the image and its captions.
              </p>
              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  className="inline-flex items-center justify-center rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
                  onClick={() => setPendingDeleteId(null)}
                  type="button"
                  disabled={deletingImageId === pendingDeleteId}
                >
                  Cancel
                </button>
                <button
                  className="inline-flex items-center justify-center rounded-full border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
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
