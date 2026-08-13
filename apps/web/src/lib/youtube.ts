const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Accepts a bare video id or any common YouTube URL shape; returns the id. */
export function extractYoutubeId(input: string): string | null {
  if (YOUTUBE_ID_RE.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.hostname === "youtu.be") {
      const id = url.pathname.slice(1);
      return YOUTUBE_ID_RE.test(id) ? id : null;
    }
    if (url.hostname.endsWith("youtube.com") || url.hostname.endsWith("youtube-nocookie.com")) {
      const v = url.searchParams.get("v");
      if (v && YOUTUBE_ID_RE.test(v)) return v;
      const parts = url.pathname.split("/");
      const embedIdx = parts.findIndex((p) => p === "embed" || p === "shorts");
      if (embedIdx !== -1 && YOUTUBE_ID_RE.test(parts[embedIdx + 1] ?? "")) {
        return parts[embedIdx + 1];
      }
    }
  } catch {
    // not a URL
  }
  return null;
}
