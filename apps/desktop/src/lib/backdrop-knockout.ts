/**
 * Where the page's own text and controls sit over the dot field, so the field
 * can clear away around them and nothing is read over dots.
 */

/**
 * Controls are cleared as whole boxes and their insides are not read. The code
 * editor and the backpack grid count as one each: solid surfaces full of controls.
 */
const CONTROLS =
  "button, input, textarea, select, [role='switch'], [role='slider'], svg, img, canvas, .cm-editor, .inventory-grid";
/** Transitions of these properties can move text; colour and opacity cannot. */
const MOVES_TEXT =
  /^(transform|translate|scale|rotate|width|height|inset|top|right|bottom|left|margin|padding|content-visibility)/;
/** Clear space around a line of text, in CSS px. Line boxes already carry leading. */
export const TEXT_PAD_X = 4;
export const TEXT_PAD_Y = 2;
/** Clear space around a control, in CSS px. */
export const CONTROL_PAD = 2;

type Frame = { left: number; top: number; width: number; height: number };

/** Content of a closed fold, or visually hidden screen-reader text: nothing shows. */
function unseen(element: Element): boolean {
  if (element instanceof HTMLElement && element.hidden) return true;
  if (element.classList.contains("sr-only")) return true;
  const parent = element.parentElement;
  return parent instanceof HTMLDetailsElement && !parent.open && element.localName !== "summary";
}

/**
 * Boxes, as flat x0, y0, x1, y1 runs in CSS px relative to `frame`, around
 * every visible line of text and every control inside `scope`. `skip` (the
 * backdrop itself) is never read, nor are hidden panes, closed folds and
 * screen-reader-only text. Boxes wholly outside the frame are dropped.
 */
export function readKnockouts(scope: Element, skip: Element | null, frame: Frame): number[] {
  const boxes: number[] = [];
  const add = (rect: DOMRectReadOnly, padX: number, padY: number) => {
    if (rect.width <= 0 || rect.height <= 0) return;
    const x0 = rect.left - frame.left - padX;
    const y0 = rect.top - frame.top - padY;
    const x1 = rect.right - frame.left + padX;
    const y1 = rect.bottom - frame.top + padY;
    if (x1 <= 0 || y1 <= 0 || x0 >= frame.width || y0 >= frame.height) return;
    boxes.push(x0, y0, x1, y1);
  };
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentElement;
        if (parent && unseen(parent)) return NodeFilter.FILTER_REJECT;
        return (node as Text).data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      const element = node as Element;
      if (element === skip || unseen(element)) return NodeFilter.FILTER_REJECT;
      if (element.matches(CONTROLS)) {
        add(element.getBoundingClientRect(), CONTROL_PAD, CONTROL_PAD);
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_SKIP;
    },
  });
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) add(rect, TEXT_PAD_X, TEXT_PAD_Y);
  }
  return boxes;
}

/**
 * Call `changed` whenever text over the field may have moved: scrolling,
 * content changes, loaded images and fonts, and transitions. A transition or
 * animation starting calls it with `moving`, asking for updates every frame
 * until the motion is over. Returns the cleanup.
 */
export function watchKnockouts(
  scope: Element,
  skip: Element | null,
  changed: (moving: boolean) => void,
): () => void {
  // Colour and opacity transitions leave text where it is; the backdrop's own
  // entrance is not the page's.
  const movesText = (event: Event) =>
    event.target !== skip &&
    (!("propertyName" in event) || MOVES_TEXT.test(String(event.propertyName)));
  const settled = () => changed(false);
  const ended = (event: Event) => {
    if (movesText(event)) changed(false);
  };
  const started = (event: Event) => {
    if (movesText(event)) changed(true);
  };
  const observer =
    typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver((records) => {
          // Resizing the backdrop's own layers is not the page moving.
          if (records.some((record) => !skip?.contains(record.target))) settled();
        });
  observer?.observe(scope, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "open"],
  });
  const listeners: [string, (event: Event) => void][] = [
    ["scroll", settled],
    ["load", settled],
    ["transitionrun", started],
    ["animationstart", started],
    ["transitionend", ended],
    ["transitioncancel", ended],
    ["animationend", ended],
    ["animationcancel", ended],
  ];
  for (const [type, listener] of listeners) {
    scope.addEventListener(type, listener, { capture: true, passive: true });
  }
  const fonts = typeof document === "undefined" ? undefined : document.fonts;
  fonts?.addEventListener?.("loadingdone", settled);
  return () => {
    observer?.disconnect();
    for (const [type, listener] of listeners) {
      scope.removeEventListener(type, listener, { capture: true });
    }
    fonts?.removeEventListener?.("loadingdone", settled);
  };
}
