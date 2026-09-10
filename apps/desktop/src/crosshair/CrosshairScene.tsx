import { useState } from "react";
import { useViewmodelPreview } from "../hooks/useViewmodelPreview";
import type { Api } from "../lib/api";
import { isTauri } from "../lib/bridge";

export function CrosshairScene({ api }: { api: Api }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const native = isTauri();
  const scene = useViewmodelPreview(api, native ? "scout_blank" : null);
  const src = native
    ? scene.src
    : "https://raw.githubusercontent.com/Yttrium-tYcLief/CompVMInstaller/b215a5cdfcd809ec3c2d71529e7a1eb22a72a39e/Project/CompVMInstaller/Resources/scout_blank.jpg";
  return src && src !== failedSrc ? (
    <img
      src={src}
      alt=""
      onError={() => setFailedSrc(src)}
      className="pointer-events-none absolute inset-0 size-full object-cover"
    />
  ) : (
    <span className="t-meta absolute left-3 top-3">
      {scene.loading ? "Loading scene…" : "Scene unavailable"}
    </span>
  );
}
