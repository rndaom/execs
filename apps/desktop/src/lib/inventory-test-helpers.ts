import { act } from "react";

function findButton(root: ParentNode, name: string) {
  return [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) =>
      button.textContent?.trim() === name ||
      button.getAttribute("aria-label") === name ||
      // Menu items carry a count beside their label.
      button.firstElementChild?.textContent?.trim() === name,
  );
}

/** Opens one of the Inventory toolbar menus and chooses an item (menus render in a portal). */
export async function chooseInventoryMenu(box: HTMLElement, trigger: string, item: string) {
  const opener = findButton(box, trigger);
  if (!opener) throw Error(`Missing menu ${trigger}`);
  await act(async () => opener.click());
  const menu = document.querySelector('[role="menu"]');
  const choice = menu && findButton(menu, item);
  if (!choice) throw Error(`Missing menu item ${item}`);
  await act(async () => choice.click());
}

/** Moves the selection through More → Move selected to…, defaulting to slot 1 of the current page. */
export async function moveSelectedInDraft(box: HTMLElement) {
  await chooseInventoryMenu(box, "More inventory actions", "Move selected to…");
  const move = findButton(box, "Move selected in draft");
  if (!move) throw Error("Missing Move selected in draft");
  await act(async () => move.click());
}
