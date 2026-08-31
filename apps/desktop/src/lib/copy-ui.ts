/** Transient "Copied" feedback shared by every copy-to-clipboard button. */
export const COPY_FEEDBACK_MS = 1_800;

export type CopyFeedback = "idle" | "copied" | "failed";

export function copyButtonLabel(feedback: CopyFeedback, idleLabel = "Copy"): string {
  if (feedback === "copied") {
    return "Copied";
  }
  if (feedback === "failed") {
    return "Copy failed";
  }
  return idleLabel;
}

/** Write to the clipboard and report whether it actually succeeded. */
export async function copyToClipboard(text: string): Promise<CopyFeedback> {
  try {
    if (!navigator.clipboard) {
      return "failed";
    }
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
