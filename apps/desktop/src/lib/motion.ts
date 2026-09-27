/** True when the OS or execs' own Reduce setting asks for no movement. Script-driven
 * animations (Web Animations, canvas) check this; CSS transitions follow the global rules. */
export function prefersReducedMotion(): boolean {
  return (
    document.documentElement.dataset.motion === "reduce" ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/** Runs a Web Animation when the engine supports it and motion is allowed. */
export function animate(
  element: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | null {
  if (typeof element.animate !== "function" || prefersReducedMotion()) return null;
  return element.animate(keyframes, options);
}
