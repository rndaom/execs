import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { AutosaveActivity } from "../hooks/useAutosave";
import type { StockCrosshairSprite } from "../lib/bridge";
import { CROSSHAIR_CANVAS_SIZE } from "../lib/crosshair-ui";

/** A 100 MB PNG decodes into the webview; `accept` is only a hint. */
export const MAX_PNG_BYTES = 2 * 1024 * 1024;
/** Matches the native cap on a stored crosshair VTF. */
export const MAX_VTF_BYTES = 16 * 1024 * 1024;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const VTF_MAGIC = [0x56, 0x54, 0x46, 0x00];

export type PendingImage = {
  image: HTMLImageElement;
  url: string;
  width: number;
  height: number;
  label: string;
};

function fileLabel(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim() || "Imported";
}

/**
 * Fit an image into the 64×64 sprite, centred, keeping its proportions.
 * Enlarging keeps hard pixels; shrinking averages so thin lines survive.
 */
export function rasterizeToSprite(
  image: CanvasImageSource,
  width: number,
  height: number,
): number[] | null {
  const scratch = document.createElement("canvas");
  scratch.width = CROSSHAIR_CANVAS_SIZE;
  scratch.height = CROSSHAIR_CANVAS_SIZE;
  const ctx = scratch.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.clearRect(0, 0, CROSSHAIR_CANVAS_SIZE, CROSSHAIR_CANVAS_SIZE);
  const scale = Math.min(CROSSHAIR_CANVAS_SIZE / width, CROSSHAIR_CANVAS_SIZE / height);
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.imageSmoothingQuality = "high";
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  ctx.drawImage(
    image,
    Math.round((CROSSHAIR_CANVAS_SIZE - w) / 2),
    Math.round((CROSSHAIR_CANVAS_SIZE - h) / 2),
    w,
    h,
  );
  return Array.from(ctx.getImageData(0, 0, CROSSHAIR_CANVAS_SIZE, CROSSHAIR_CANVAS_SIZE).data);
}

async function startsWith(file: File, magic: number[]): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, magic.length).arrayBuffer());
  return magic.every((byte, index) => head[index] === byte);
}

/**
 * Import a PNG or VTF into the library under its file name.
 *
 * Validates before decoding anything into a texture: size caps, real file
 * signatures (an extension is not evidence), exact 64×64 PNGs or an explicit
 * choice to fit, and the native VTF reader for VTFs. Hiding the pane cancels
 * an import in flight.
 */
export function useCrosshairImport({
  onImage,
  onVtf,
  previewVtf,
}: {
  onImage: (pixels: number[], label: string) => void;
  onVtf: (bytes: number[], sprite: StockCrosshairSprite, label: string) => void;
  previewVtf: (bytes: number[]) => Promise<StockCrosshairSprite>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingImage | null>(null);
  const [reading, setReading] = useState(false);
  const active = useContext(AutosaveActivity);
  const generation = useRef(0);
  const decoding = useRef<{ image: HTMLImageElement; url: string } | null>(null);

  const cancel = useCallback(() => {
    generation.current += 1;
    setReading(false);
    if (decoding.current) {
      decoding.current.image.onload = null;
      decoding.current.image.onerror = null;
      URL.revokeObjectURL(decoding.current.url);
      decoding.current = null;
    }
    setPending(null);
  }, []);

  useEffect(() => cancel, [cancel]);
  useEffect(() => {
    if (!active) cancel();
  }, [active, cancel]);

  async function pick(file: File) {
    cancel();
    const request = generation.current;
    const current = () => generation.current === request;
    setError(null);
    const label = fileLabel(file.name);
    try {
      if (/\.vtf$/i.test(file.name) || (await startsWith(file, VTF_MAGIC))) {
        if (!current()) return;
        if (file.size > MAX_VTF_BYTES) {
          setError(`That VTF is ${(file.size / (1024 * 1024)).toFixed(1)} MB; the limit is 16 MB.`);
          return;
        }
        setReading(true);
        const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
        if (!current()) return;
        const sprite = await previewVtf(bytes);
        if (!current()) return;
        setReading(false);
        onVtf(bytes, sprite, label);
        return;
      }
      if (file.size > MAX_PNG_BYTES) {
        setError(`That PNG is ${(file.size / (1024 * 1024)).toFixed(1)} MB; the limit is 2 MB.`);
        return;
      }
      if (!(await startsWith(file, PNG_MAGIC))) {
        if (current()) setError("Choose a PNG or VTF file.");
        return;
      }
      if (!current()) return;
      const url = URL.createObjectURL(file);
      const image = new Image();
      decoding.current = { image, url };
      image.onload = () => {
        if (!current()) return;
        const { naturalWidth: width, naturalHeight: height } = image;
        if (width === CROSSHAIR_CANVAS_SIZE && height === CROSSHAIR_CANVAS_SIZE) {
          const pixels = rasterizeToSprite(image, width, height);
          cancel();
          if (pixels) onImage(pixels, label);
          else setError("Could not read that PNG.");
          return;
        }
        setPending({ image, url, width, height, label });
      };
      image.onerror = () => {
        if (!current()) return;
        cancel();
        setError("That PNG could not be decoded.");
      };
      image.src = url;
    } catch (err) {
      if (!current()) return;
      cancel();
      setError(err instanceof Error && err.message ? err.message : "Could not read that file.");
    }
  }

  function fit() {
    if (!pending) return;
    const pixels = rasterizeToSprite(pending.image, pending.width, pending.height);
    const label = pending.label;
    cancel();
    if (pixels) onImage(pixels, label);
    else setError("Could not read that PNG.");
  }

  return {
    pick,
    pending,
    reading,
    error,
    fit,
    cancel,
    dismissError: () => setError(null),
  };
}
