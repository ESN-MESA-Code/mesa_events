"use client";

// The pictures of Telegram posts (round 2026-11-03): a stored picture shown
// from its private bucket (an upload of a post, or a default of the
// Pictures tab), and the button that adds one.
import { useEffect, useState } from "react";
import { ImagePlus } from "lucide-react";
import { buttonVariants } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import { storedPicture } from "@/lib/telegram/picture";
import { cn } from "@/lib/utils";

/** A stored picture of a Telegram post (an upload, or a default of the Pictures tab), shown from its private bucket. */
export function UploadedPicture({ picture, className }: { picture: string | null; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const stored = storedPicture(picture);
  const bucket = stored?.bucket;
  const path = stored?.path;
  useEffect(() => {
    if (!bucket || !path) return;
    let alive = true;
    supabase.storage
      .from(bucket)
      .createSignedUrl(path, 600)
      .then(({ data }) => alive && setUrl(data?.signedUrl ?? ""));
    return () => {
      alive = false;
    };
  }, [bucket, path]);
  if (!path) return picture ? <p className="truncate text-gray-500">🖼 {picture}</p> : null;
  if (url === "") return <p className="text-gray-500">🖼 The picture (removed here once the post is out)</p>;
  // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL of a private file
  return url ? <img src={url} alt="Picture of the post" className={cn("max-h-48 rounded border border-gray-200 object-contain", className)} /> : <p className="text-gray-500">🖼 Loading the picture…</p>;
}

/** A clear button that opens the file picker (round 2026-11-03): JPG, PNG or WebP up to 10 MB. */
export function PictureButton({ label, ariaLabel, disabled, onFile }: { label: string; ariaLabel?: string; disabled?: boolean; onFile: (file: File) => void }) {
  return (
    <label className={cn(buttonVariants({ size: "sm", variant: "outline" }), "cursor-pointer gap-1.5", disabled && "pointer-events-none opacity-50")}>
      <ImagePlus className="h-4 w-4" aria-hidden="true" />
      {label}
      <input
        aria-label={ariaLabel ?? label}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
    </label>
  );
}

/** JPG, PNG or WebP up to 10 MB, or why not. */
export function pictureProblem(file: File): string | null {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return "Telegram takes JPG, PNG or WebP pictures (no HEIC).";
  if (file.size > 10 * 1024 * 1024) return "The picture is larger than 10 MB – use a smaller copy.";
  return null;
}
