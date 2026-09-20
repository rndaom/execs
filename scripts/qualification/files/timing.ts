/** Passive fixture-only observations; no product state or input mutations. */
export function observeQualificationTiming() {
  const evidence = {
    readyMs: null as number | null,
    completionMs: [] as number[],
    completionP95Ms: null as number | null,
    scope:
      "Navigation start to editor plus settled analysis; physical Ctrl+Space keydown to visible completion DOM, not compositor presentation",
  };
  let completionStarted: number | null = null;
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.ctrlKey &&
        event.code === "Space" &&
        document.activeElement?.classList.contains("cm-content")
      ) {
        completionStarted = performance.now();
      }
      if (event.key === "Escape") completionStarted = null;
    },
    true,
  );
  new MutationObserver(() => {
    if (
      evidence.readyMs === null &&
      document.querySelector(".cm-content") &&
      document.body.innerText.includes("Current draft checked")
    )
      evidence.readyMs = performance.now();
    if (completionStarted !== null && document.querySelector(".cm-tooltip-autocomplete li")) {
      evidence.completionMs.push(performance.now() - completionStarted);
      completionStarted = null;
      const sorted = [...evidence.completionMs].sort((a, b) => a - b);
      evidence.completionP95Ms = sorted[Math.ceil(sorted.length * 0.95) - 1];
    }
  }).observe(document, { subtree: true, childList: true, characterData: true });
  return evidence;
}
