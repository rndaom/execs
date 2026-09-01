import { useCallback, useEffect, useRef, useState } from "react";
import { COPY_FEEDBACK_MS, type CopyFeedback, copyToClipboard } from "../lib/copy-ui";

/** Copy-to-clipboard with the shared transient feedback window and cleanup. */
export function useCopyFeedback(): {
  feedback: CopyFeedback;
  copy: (text: string) => Promise<void>;
} {
  const [feedback, setFeedback] = useState<CopyFeedback>("idle");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
    };
  }, []);

  const copy = useCallback(async (text: string) => {
    setFeedback(await copyToClipboard(text));
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
    }
    timer.current = window.setTimeout(() => {
      setFeedback("idle");
      timer.current = null;
    }, COPY_FEEDBACK_MS);
  }, []);

  return { feedback, copy };
}
