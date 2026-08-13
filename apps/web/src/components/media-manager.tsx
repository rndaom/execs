"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** Owner-only controls to add/remove screenshots and YouTube videos. */
export function MediaManager({
  configId,
  mediaIds,
}: {
  configId: string;
  mediaIds: string[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [youtube, setYoutube] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(body: FormData) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/configs/${configId}/media`, { method: "POST", body });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "failed");
        return;
      }
      setYoutube("");
      router.refresh();
    } catch {
      setError("network error");
    } finally {
      setBusy(false);
    }
  }

  async function removeLast() {
    const mediaId = mediaIds[mediaIds.length - 1];
    if (!mediaId) return;
    setBusy(true);
    try {
      await fetch(`/api/configs/${configId}/media`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-edge p-3 text-sm">
      <p className="text-xs text-ink-faint">
        Your config — add TF2 screenshots (PNG/JPEG/WebP, ≤5MB) or a YouTube link. Media must show
        TF2.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const form = new FormData();
          form.set("image", file);
          send(form);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
          Add screenshot
        </Button>
        <input
          value={youtube}
          onChange={(e) => setYoutube(e.target.value)}
          placeholder="YouTube link…"
          className="w-56 rounded border border-edge bg-background px-2 py-1 text-xs"
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || !youtube.trim()}
          onClick={() => {
            const form = new FormData();
            form.set("youtube", youtube.trim());
            send(form);
          }}
        >
          Add video
        </Button>
        {mediaIds.length > 0 && (
          <Button size="sm" variant="destructive" disabled={busy} onClick={removeLast}>
            Remove last
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
