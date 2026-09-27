import { prefersReducedMotion } from "./motion";

/*
 * Entrances: a screen's parts arrive one after another instead of all at once
 * or piece by piece as reads finish. Everything here is finite, runs through
 * the Web Animations API and is skipped when motion is reduced. Holds give a
 * real result (a confirmed install, a finished load) a short beat on screen;
 * they are zero in tests and with reduced motion, so nothing waits for an
 * animation that will not play.
 */

const EASE_OUT = "cubic-bezier(0.2, 0, 0, 1)";
/** Only the first few blocks stagger; later ones arrive with the last. */
const MAX_STAGGERED = 7;

/** A hold in milliseconds, or zero when motion is reduced or under test. */
export function motionHold(ms: number): number {
  if (import.meta.env.MODE === "test") return 0;
  if (typeof document === "undefined" || prefersReducedMotion()) return 0;
  return ms;
}

const running = new WeakMap<Element, Animation>();

export type RevealOptions = {
  /** Before the first block, in ms. */
  delay?: number;
  /** Between blocks, in ms. */
  step?: number;
  /** Travel in px along the axis; 0 fades only. */
  distance?: number;
  axis?: "x" | "y";
  duration?: number;
};

/** Fades (and slightly lifts) each element in, one after another. */
export function revealBlocks(elements: readonly Element[], options: RevealOptions = {}) {
  if (elements.length === 0 || prefersReducedMotion()) return;
  const { delay = 0, step = 45, distance = 8, axis = "y", duration = 320 } = options;
  const from =
    distance === 0
      ? "none"
      : axis === "y"
        ? `translateY(${distance}px)`
        : `translateX(${distance}px)`;
  elements.forEach((element, index) => {
    if (typeof element.animate !== "function") return;
    running.get(element)?.cancel();
    const animation = element.animate(
      [
        { opacity: 0, transform: from },
        { opacity: 1, transform: "none" },
      ],
      {
        duration,
        delay: delay + Math.min(index, MAX_STAGGERED) * step,
        easing: EASE_OUT,
        fill: "backwards",
      },
    );
    running.set(element, animation);
  });
}

function shown(element: Element): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    !element.hidden &&
    element.getAttribute("aria-hidden") !== "true" &&
    (typeof element.getClientRects !== "function" || element.getClientRects().length > 0)
  );
}

/**
 * The visible blocks of a pane: descend through single-child wrappers until
 * content splits into several parts (header, sections, notes).
 */
export function contentBlocks(root: Element | null): HTMLElement[] {
  let node: Element | null = root;
  for (let depth = 0; node && depth < 6; depth += 1) {
    const children = Array.from(node.children).filter(shown);
    if (children.length === 0) return [];
    if (children.length > 1) return children;
    node = children[0];
  }
  return node && shown(node) ? [node] : [];
}

/** Reveals the visible pane of the settings workspace. */
export function revealPane(root: ParentNode | null, delay = 0) {
  const pane = root?.querySelector(".settings-pane") ?? null;
  revealBlocks(contentBlocks(pane), { delay, step: 45, distance: 8 });
}

/**
 * Reveals whatever screen is showing: the header and sidebar of the ready
 * shell and its pane, or an onboarding frame's parts.
 */
export function revealScreen(root: ParentNode | null, delay = 0) {
  if (!root) return;
  const header = root.querySelector("[data-reveal='header']");
  if (header) revealBlocks([header], { delay, distance: 0, duration: 360 });
  const nav = Array.from(
    root.querySelectorAll(".settings-nav-heading, .settings-nav-item, .settings-utility"),
  ).filter(shown);
  if (nav.length > 0) {
    // The whole list staggers; the per-block cap would bunch the lower items.
    nav.forEach((item, index) => {
      revealBlocks([item], { delay: delay + 60 + index * 22, distance: -6, axis: "x" });
    });
  }
  revealPane(root, delay + 140);
  for (const group of Array.from(root.querySelectorAll("[data-reveal='group']"))) {
    revealGroup(group, delay);
  }
}

/** An onboarding frame's parts, top to bottom. */
export function revealGroup(group: Element, delay = 0) {
  const parts = Array.from(group.children).filter(shown);
  revealBlocks(parts, { delay, step: 70, distance: 10, duration: 380 });
}
