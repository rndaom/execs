import { useLayoutEffect, useRef } from "react";
import { motionHold } from "../lib/entrance";
import { prefersReducedMotion } from "../lib/motion";
import { Tf2Mark } from "./ui/Spinner";
import { Wordmark } from "./ui/Wordmark";

const EASE_OUT = "cubic-bezier(0.2, 0, 0, 1)";
/** The wordmark's flight; the splash is removed when it lands. */
const FLIGHT_MS = 640;

function centre(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * The startup screen. index.html draws the same veil and emblem before any
 * script runs, so the window is never blank; this adds the wordmark and the
 * real read startup is waiting for. When it leaves, the emblem and status
 * fade, the veil lifts off the first screen and the wordmark travels to that
 * screen's own wordmark.
 */
export function BootSplash({
  status,
  leaving,
  onDone,
}: {
  status: string;
  leaving: boolean;
  onDone: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  // Settled startup has no status; keep the last read on screen as it fades.
  const shownStatus = useRef(status);
  if (status) shownStatus.current = status;

  useLayoutEffect(() => {
    if (!leaving) return;
    const splash = root.current;
    const finish = () => done.current();
    if (!splash || prefersReducedMotion() || typeof splash.animate !== "function") {
      finish();
      return;
    }
    const word = splash.querySelector<HTMLElement>(".boot-splash-word");
    const sourceDot = word?.querySelector("[data-wordmark-dot]");
    const target = Array.from(document.querySelectorAll<HTMLElement>("[data-wordmark]")).find(
      (node) => !splash.contains(node) && node.getClientRects().length > 0,
    );
    const targetDot = target?.querySelector("[data-wordmark-dot]");

    splash.querySelector(".boot-splash-veil")?.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 420,
      delay: 140,
      easing: "ease",
      fill: "forwards",
    });
    for (const part of splash.querySelectorAll(".boot-splash-emblem, .boot-splash-status")) {
      part.animate(
        [
          { opacity: 1, transform: "none" },
          { opacity: 0, transform: "scale(0.9)" },
        ],
        { duration: 200, easing: "ease", fill: "forwards", composite: "add" },
      );
    }

    if (word && sourceDot && target && targetDot) {
      // Land dot on dot: both wordmarks share one em-based shape, so scaling
      // by the dot's size lines the name up too.
      const from = sourceDot.getBoundingClientRect();
      const to = targetDot.getBoundingClientRect();
      const box = word.getBoundingClientRect();
      const origin = centre(from);
      const end = centre(to);
      const scale = from.width > 0 ? to.width / from.width : 1;
      word.style.transformOrigin = `${origin.x - box.left}px ${origin.y - box.top}px`;
      target.setAttribute("data-wordmark-held", "");
      word.animate(
        [
          { transform: "none" },
          {
            transform: `translate(${end.x - origin.x}px, ${end.y - origin.y}px) scale(${scale})`,
          },
        ],
        { duration: FLIGHT_MS, easing: EASE_OUT, fill: "forwards" },
      );
      const timer = window.setTimeout(() => {
        target.removeAttribute("data-wordmark-held");
        finish();
      }, FLIGHT_MS);
      return () => {
        window.clearTimeout(timer);
        target.removeAttribute("data-wordmark-held");
      };
    }

    word?.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 240,
      easing: "ease",
      fill: "forwards",
    });
    const timer = window.setTimeout(finish, motionHold(560));
    return () => window.clearTimeout(timer);
  }, [leaving]);

  return (
    <div
      ref={root}
      className="boot-splash"
      data-leaving={leaving ? "true" : undefined}
      role="status"
      aria-live="polite"
      data-testid="boot-splash"
    >
      <div className="boot-splash-veil" />
      <span className="boot-splash-emblem" aria-hidden="true">
        <Tf2Mark size={36} />
      </span>
      <div className="boot-splash-copy">
        <div className="boot-splash-word">
          <Wordmark size={30} />
        </div>
        <p className="boot-splash-status t-meta">{shownStatus.current}</p>
      </div>
    </div>
  );
}
