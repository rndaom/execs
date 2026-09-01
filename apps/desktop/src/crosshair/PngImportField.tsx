import { UploadSimple } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { Alert } from "../components/ui/Alert";
import { CROSSHAIR_CANVAS_SIZE } from "../lib/crosshair-ui";

/** A 100 MB PNG decodes into the webview; `accept` is only a hint. */
const MAX_PNG_BYTES = 2 * 1024 * 1024;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

type Pending = { image: HTMLImageElement; url: string; width: number; height: number };

function rasterize(image: CanvasImageSource, width: number, height: number): number[] | null {
  const scratch = document.createElement("canvas");
  scratch.width = CROSSHAIR_CANVAS_SIZE;
  scratch.height = CROSSHAIR_CANVAS_SIZE;
  const ctx = scratch.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.clearRect(0, 0, CROSSHAIR_CANVAS_SIZE, CROSSHAIR_CANVAS_SIZE);
  // Hard alpha: the VTF path bakes the buffer as-is, and smoothing would turn
  // crisp sprite edges into a soft halo in game.
  ctx.imageSmoothingEnabled = false;
  const scale = Math.min(CROSSHAIR_CANVAS_SIZE / width, CROSSHAIR_CANVAS_SIZE / height);
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

/**
 * Import a PNG as the "custom" crosshair.
 *
 * Validates before it decodes anything into a texture: size cap, real PNG
 * magic bytes (a renamed JPEG used to sail through), exact 64×64 dimensions
 * with an explicit opt-in to rescale, and an inline message on a decode
 * failure instead of the old silent `onerror` return.
 */
export function PngImportField({
  locked,
  onImport,
}: {
  locked: boolean;
  onImport: (pixels: number[]) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function reset() {
    setPending((current) => {
      if (current) {
        URL.revokeObjectURL(current.url);
      }
      return null;
    });
  }

  async function accept(file: File) {
    reset();
    setError(null);
    if (file.size > MAX_PNG_BYTES) {
      setError(
        `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Crosshair PNGs must be under 2 MB.`,
      );
      return;
    }
    const head = new Uint8Array(await file.slice(0, PNG_MAGIC.length).arrayBuffer());
    if (PNG_MAGIC.some((byte, index) => head[index] !== byte)) {
      setError("That is not a PNG file — check the extension and try again.");
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const { naturalWidth: width, naturalHeight: height } = image;
      if (width === CROSSHAIR_CANVAS_SIZE && height === CROSSHAIR_CANVAS_SIZE) {
        const pixels = rasterize(image, width, height);
        URL.revokeObjectURL(url);
        if (pixels) {
          onImport(pixels);
        } else {
          setError("Could not read the image data from that PNG.");
        }
        return;
      }
      setPending({ image, url, width, height });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setError("That PNG could not be decoded. It may be corrupt.");
    };
    image.src = url;
  }

  return (
    <div className="mt-5">
      <p className="eyebrow">Import a 64 × 64 PNG</p>
      <label className="btn btn-ghost mt-2 w-full">
        <UploadSimple size={14} />
        Choose a PNG…
        <input
          ref={inputRef}
          data-testid="crosshair-import-png"
          type="file"
          accept="image/png"
          disabled={locked}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) {
              void accept(file);
            }
          }}
        />
      </label>

      {error ? (
        <Alert tone="error" testId="crosshair-import-error" className="mt-2 px-3 py-2 text-xs">
          {error}
        </Alert>
      ) : null}

      {pending ? (
        <div data-testid="crosshair-import-resize" className="mt-2 text-[11px] leading-4">
          <p className="text-ink-muted">
            That PNG is {pending.width} × {pending.height}. Crosshair sprites are 64 × 64.
          </p>
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              data-testid="crosshair-import-scale"
              className="btn btn-ghost px-3 py-1 text-[11px]"
              onClick={() => {
                const pixels = rasterize(pending.image, pending.width, pending.height);
                reset();
                if (pixels) {
                  onImport(pixels);
                } else {
                  setError("Could not read the image data from that PNG.");
                }
              }}
            >
              Scale to 64 × 64
            </button>
            <button
              type="button"
              className="btn btn-ghost px-3 py-1 text-[11px]"
              onClick={() => reset()}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
