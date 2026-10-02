// Captures the desktop app's browser preview for the promo video and README.
//
//   node <repo>/node_modules/vite/bin/vite.js --config tools/promo/capture/vite.config.ts
//   pnpm capture                      (both sets; pass flow names to capture a subset)
//
// Each flow drives the real interface over the app's preview fixtures at 2x and
// snaps the states the video cuts between. Video captures go to
// public/captures (gitignored) with the element boxes the video frames on in
// public/captures/targets.json; README captures go to docs/media/screen-*.png.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.EXECS_CAPTURE_URL ?? "http://localhost:1433";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const promo = path.resolve(import.meta.dirname, "..");
const VIDEO = path.join(promo, "public/captures");
const README = path.resolve(promo, "../../docs/media");

/** Hosts of third-party HUD and mod art; blocked so no such artwork is captured. */
const REMOTE_ART = [
  "*githubusercontent.com*",
  "*gamebanana.com*",
  "*imgur.com*",
  "*comfig.app*",
  "*tf2huds.dev*",
];

/** The Crosshair scene's three clicks: gallery label and capture name. */
const CROSSHAIR_PICKS = [
  ["Cross with gaps", "tf2"],
  ["Circle + dot", "circle"],
  ["X", "x"],
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const button = "button, [role=button], [role=tab], [role=menuitem], summary";

/** Centre of the nth visible element matching `selector` whose label or text holds `text`. */
async function locate(page, selector, text, { exact = false, nth = 0 } = {}) {
  const handle = await page.waitForFunction(
    (selector, text, exact, nth) => {
      const hits = [...document.querySelectorAll(selector)].filter((element) => {
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return false;
        const value = (
          element.getAttribute("aria-label") ||
          element.getAttribute("placeholder") ||
          element.textContent ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim();
        return exact ? value === text : value.includes(text);
      });
      const hit = hits[nth];
      if (!hit) return null;
      hit.scrollIntoView({ block: "nearest" });
      const box = hit.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    },
    { timeout: 8000 },
    selector,
    text,
    exact,
    nth,
  );
  return handle.jsonValue();
}

async function click(page, selector, text, options = {}) {
  const { x, y } = await locate(page, selector, text, options);
  if (options.ctrl) await page.keyboard.down("Control");
  await page.mouse.click(x, y);
  if (options.ctrl) await page.keyboard.up("Control");
  await sleep(options.settle ?? 450);
}

/** Scroll the pane's own scroller so the matching element sits `offset` px below its top. */
async function scrollToText(page, selector, text, offset = 80) {
  await page.evaluate(
    (selector, text, offset) => {
      const target = [...document.querySelectorAll(selector)].find((element) =>
        element.textContent.includes(text),
      );
      let scroller = target?.parentElement;
      while (scroller) {
        const overflow = getComputedStyle(scroller).overflowY;
        if (scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(overflow)) break;
        scroller = scroller.parentElement;
      }
      if (!target || !scroller) return;
      const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTop += top - offset;
    },
    selector,
    text,
    offset,
  );
  await sleep(500);
}

async function open(page, state) {
  await page.goto(`${BASE}/?preview=${state}`, { waitUntil: "load", timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await sleep(2500);
}

/** Park the pointer over the sidebar's empty foot, so no hover state is captured. */
async function park(page) {
  await page.mouse.move(60, page.viewport().height - 120);
  await sleep(250);
}

/** Saving a profile opens the welcome tour, as after first-run setup; close it. */
async function skipWelcome(page) {
  const skipped = await page.evaluate(() => {
    const skip = [...document.querySelectorAll("[role=dialog] button")].find(
      (element) => element.textContent.trim() === "Skip",
    );
    skip?.click();
    return Boolean(skip);
  });
  if (skipped) await sleep(700);
}

async function openProfiles(page) {
  await click(page, "header summary", "Profile", { settle: 500 });
}

const TYPED =
  '\n// Movement\nbind "mouse4" "+jump"\nbind "q" "lastinv"\n\n// Network\ncl_interp 0.0152\ncl_cmdrate 66\ncl_updaterate 66\nrate 196608\n';

/** Hides page-one items but keeps the chrome: the backdrop tiles fly over. */
const HIDE_ITEMS = ".inventory-grid [data-item-id] { visibility: hidden !important; }";

/**
 * Flows: each walks one part of the interface and snaps named states.
 * `snap(name, { park, hideItems })` screenshots and measures the current state.
 */
const FLOWS = {
  profiles: async (page, snap) => {
    await open(page, "settings-comfig");
    await openProfiles(page);
    for (const name of ["Competitive", "Casual", "Potato PC"]) {
      const { x, y } = await locate(page, "input", "Save current as");
      await page.mouse.click(x, y, { clickCount: 3 });
      await page.keyboard.type(name);
      await page.keyboard.press("Enter");
      await sleep(700);
      await skipWelcome(page);
    }
    await page.evaluate(() => document.activeElement?.blur());
    await snap("profiles-menu");
    await click(page, button, "Actions for Competitive", { exact: true, settle: 400 });
    await click(page, button, "Compare with current", { settle: 1200 });
    await snap("compare");
    await click(page, "button", "Switch to Competitive", { settle: 2600 });
    await snap("switch-done");
  },
  comfig: async (page, snap) => {
    await open(page, "settings-comfig");
    await snap("comfig-medium");
    await click(page, "label", "High", { settle: 1000 });
    await snap("comfig-high");
  },
  binds: async (page, snap) => {
    await open(page, "settings-binds");
    await snap("binds");
    await click(page, "button", "Add a key for Taunt", { settle: 300 });
    await snap("binds-recording");
    await page.keyboard.press("KeyG");
    await sleep(600);
    await click(page, "button", "Add a key for Reload", { settle: 300 });
    await snap("binds-recording-reload");
    await page.keyboard.press("KeyR");
    await sleep(900);
    await page.evaluate(() => document.activeElement?.blur());
    await snap("binds-recorded");
  },
  crosshair: async (page, snap) => {
    await open(page, "settings-crosshair");
    await snap("crosshair");
    // One of TF2's own crosshairs, then two execs shapes, from the main gallery
    // (the first match; the per-weapon gallery repeats the names lower down).
    for (const [label, name] of CROSSHAIR_PICKS) {
      await click(page, "label", label, { exact: true, settle: 900 });
      await snap(`crosshair-${name}`);
    }
  },
  viewmodels: async (page, snap) => {
    await open(page, "settings-viewmodels");
    await scrollToText(page, "h2", "Per weapon", 32);
    await snap("viewmodels");
    await click(page, "label", "Hidden", { nth: 0, exact: true, settle: 600 });
    await snap("viewmodels-primary");
    await click(page, "label", "Hands only", { nth: 1, exact: true, settle: 600 });
    await snap("viewmodels-both");
  },
  sounds: async (page, snap) => {
    await open(page, "settings-sounds");
    await snap("sounds");
    await click(page, "button, label", "comfig.app", { exact: true, settle: 900 });
    await snap("sounds-comfig");
    await click(page, "button", "Use Bubble pop (comfig.app) for hits", { settle: 1200 });
    await snap("sounds-used");
  },
  files: async (page, snap) => {
    await open(page, "settings-files");
    await click(page, button, "autoexec.cfg", { settle: 600 });
    const editor = await locate(page, ".cm-content", "");
    const end = async () => {
      await page.mouse.click(editor.x, editor.y);
      await page.keyboard.down("Control");
      await page.keyboard.press("End");
      await page.keyboard.up("Control");
    };
    await end();
    await page.evaluate(() => document.activeElement?.blur());
    await snap("files-before");
    await end();
    await page.keyboard.type(TYPED, { delay: 4 });
    // Let the cfg analysis finish so the status bar shows its result.
    await page.waitForFunction(() => /Problems \d/.test(document.body.innerText), {
      timeout: 20000,
    });
    await sleep(600);
    await snap("files");
    await click(page, "button", "Problems", { settle: 900 });
    await snap("files-problems");
  },
  news: async (page, snap) => {
    await open(page, "settings-crosshair");
    await scrollToText(page, "h2", "Per weapon", 24);
    await snap("crosshair-weapons");
    await open(page, "settings-mods");
    await click(page, "label", "Sounds", { exact: true, settle: 900 });
    await snap("mods-sounds");
    await open(page, "settings-comfig-vanilla");
    await snap("comfig-vanilla");
    await open(page, "welcome");
    await sleep(2500);
    await snap("welcome");
  },
  inventory: async (page, snap) => {
    const blur = () => page.evaluate(() => document.activeElement?.blur());
    const hideId = (label) =>
      page.evaluate(
        (label) =>
          `.inventory-grid [data-item-id="${document
            .querySelector(`[data-item-id][aria-label^="${label}"]`)
            ?.getAttribute("data-item-id")}"] { visibility: hidden !important; }`,
        label,
      );
    await open(page, "settings-comfig");
    await click(page, "[data-testid=settings-tab-inventory]", "", { settle: 3500 });
    await snap("inv-grid");
    await snap("inv-grid-empty", { hideItems: true });
    // Inspect: the hover card, then the full item panel.
    const nightcap = await locate(page, "[data-item-id]", "Unusual Nightcap");
    await page.mouse.move(nightcap.x, nightcap.y);
    await sleep(1500);
    await snap("inv-hover", { park: false });
    const rifle = await locate(page, "[data-item-id]", "Dragon Slayer Sniper Rifle");
    await page.mouse.click(rifle.x, rifle.y, { clickCount: 2 });
    await sleep(1500);
    await snap("inv-inspect");
    await page.keyboard.press("Escape");
    await sleep(900);
    // Delete one item.
    await click(page, "[data-item-id]", "Gift Wrap", { settle: 500 });
    await blur();
    await snap("inv-delete-selected");
    await click(page, "button", "Delete selected", { settle: 1200 });
    await snap("inv-delete");
    await click(page, "button", "Delete item permanently", { settle: 1500 });
    await blur();
    await snap("inv-deleted");
    // Craft a random hat from three Refined Metal.
    for (const [index, slot] of ["slot 8", "slot 23", "slot 38"].entries()) {
      await click(page, "[data-item-id]", `Refined Metal, Unique, ${slot}`, {
        ctrl: index > 0,
        settle: 350,
      });
    }
    await snap("inv-selected");
    await click(page, "button", "Craft selected", { settle: 1200 });
    await snap("inv-craft");
    await click(page, "button", "Craft items permanently", { settle: 2500 });
    await snap("inv-reveal");
    await click(page, "button", "Done", { exact: true, settle: 1200 });
    await blur();
    await snap("inv-crafted");
    // Sort, then drag the Unusual into slot 1; single moves swap.
    await click(page, "button", "Sort backpack", { settle: 700 });
    await snap("inv-sort-menu", { park: false });
    await click(page, "[role=menuitem]", "By quality", { settle: 1600 });
    await snap("inv-sorted");
    await snap("inv-sorted-empty", { hideItems: true });
    const first = await page.evaluate(
      () =>
        document
          .querySelector(".inventory-grid [data-item-id][aria-label$=', slot 1']")
          ?.getAttribute("aria-label")
          ?.split(",")[0],
    );
    await snap("inv-sorted-swap", {
      hide: `${await hideId("Unusual Nightcap")}\n${await hideId(first)}`,
    });
    const from = await locate(page, "[data-item-id]", "Unusual Nightcap");
    const to = await locate(page, "[data-item-id][aria-label$=', slot 1']", "");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 20; step += 1) {
      const t = step / 20;
      await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
      await sleep(25);
    }
    await sleep(300);
    await page.mouse.up();
    await sleep(1200);
    await blur();
    await snap("inv-moved");
    // Review and apply the arrangement.
    await click(page, ".inventory-toolbar button", "Review", { settle: 1200 });
    await snap("inv-review");
    await click(page, "button", "Apply to Steam", { settle: 2000 });
    await blur();
    await snap("inv-applied");
  },
};

/**
 * Element boxes the video frames its camera, cursor and pops on, in CSS px of
 * the 1440x900 capture. Every `text` entry must appear. "climb" starts from
 * the tightest element holding the first text and climbs to the first
 * ancestor holding them all: the visible row or panel rather than the page.
 */
const MARKS = {
  "profiles-menu": {
    menu: { selector: "header details[open] > div", text: ["Import profile"] },
    actions: { selector: "button", text: ["Actions for Competitive"] },
  },
  compare: {
    dialog: { selector: "[role=dialog]", text: ["Competitive"] },
    switch: { selector: "button", text: ["Switch to Competitive"] },
  },
  "switch-done": {
    progress: { selector: "*", text: ["Profile applied", "Game closed", "Done"], pick: "climb" },
  },
  "comfig-medium": {
    high: { selector: "label", text: ["High"], exact: true },
  },
  binds: {
    taunt: { selector: "div", text: ["Taunt"], pick: "smallest" },
    reload: { selector: "div", text: ["Reload"], pick: "smallest" },
  },
  crosshair: {
    gallery: { selector: "*", text: ["Weapon default", "Outlined"], pick: "climb" },
    ...Object.fromEntries(
      CROSSHAIR_PICKS.map(([label, name]) => [
        name,
        { selector: "label", text: [label], exact: true },
      ]),
    ),
    preview: { selector: "*", text: ["Actual size on this screen"], pick: "climb" },
  },
  viewmodels: {
    primaryHidden: { selector: "label", text: ["Hidden"], exact: true },
    toolbar: { selector: "*", text: ["Every class", "Review and build"], pick: "climb" },
  },
  "viewmodels-primary": {
    secondaryHands: { selector: "label", text: ["Hands only"], exact: true, nth: 1 },
  },
  sounds: {
    filter: { selector: "button, label", text: ["comfig.app"], exact: true },
  },
  "sounds-comfig": {
    use: { selector: "button", text: ["Use Bubble pop (comfig.app) for hits"] },
  },
  "sounds-used": {
    hitSlot: { selector: "*", text: ["Hit sound", "Browse"], pick: "climb" },
    hitToggle: { selector: "[role=switch]", text: [] },
  },
  files: {
    change: { selector: "[data-testid=settings-tab-files-changed]", text: [] },
  },
  "inv-grid": {
    grid: { selector: ".inventory-grid", text: [] },
  },
  "inv-hover": {
    card: { selector: ".inventory-hovercard", text: [] },
  },
  "inv-inspect": {
    dialog: { selector: "[role=dialog]", text: ["Dragon Slayer"] },
  },
  "inv-delete-selected": {
    delete: { selector: "button", text: ["Delete selected"] },
  },
  "inv-delete": {
    dialog: { selector: "[role=dialog]", text: ["Delete item"] },
    confirm: { selector: "button", text: ["Delete item permanently"] },
  },
  "inv-selected": {
    craft: { selector: "button", text: ["Craft selected"] },
  },
  "inv-craft": {
    dialog: { selector: "[role=dialog]", text: ["Craft"] },
    confirm: { selector: "button", text: ["Craft items permanently"] },
  },
  "inv-reveal": {
    image: { selector: "[role=dialog] img", text: [] },
    dialog: { selector: "[role=dialog]", text: ["You crafted a hat"] },
    done: { selector: "button", text: ["Done"], exact: true },
  },
  "inv-crafted": {
    sort: { selector: "button", text: ["Sort backpack"] },
  },
  "inv-sort-menu": {
    quality: { selector: "[role=menuitem]", text: ["By quality"] },
  },
  "inv-sorted": {
    review: { selector: ".inventory-toolbar button", text: ["Review"] },
  },
  "inv-moved": {
    review: { selector: ".inventory-toolbar button", text: ["Review"] },
  },
  "inv-applied": {
    feedback: { selector: "p, div, span", text: ["Applied"], pick: "smallest" },
  },
  "inv-review": {
    dialog: { selector: "[role=dialog]", text: ["Apply to Steam"] },
    apply: { selector: "button", text: ["Apply to Steam"] },
  },
};

async function measure(page, { selector, text, pick = "first", exact = false, nth = 0 }) {
  return page.evaluate(
    (selector, texts, pick, exact, nth) => {
      const clean = (value) => (value ?? "").replace(/\s+/g, " ").trim();
      const area = (element) => {
        const box = element.getBoundingClientRect();
        return box.width * box.height;
      };
      let hit;
      if (pick === "climb") {
        hit = [...document.querySelectorAll(selector)]
          .filter((element) => area(element) > 0 && clean(element.textContent).includes(texts[0]))
          .sort((a, b) => area(a) - area(b))[0];
        while (hit && !texts.every((text) => clean(hit.textContent).includes(text))) {
          hit = hit.parentElement;
        }
      } else {
        const hits = [...document.querySelectorAll(selector)].filter((element) => {
          if (area(element) === 0) return false;
          const value = clean(
            element.getAttribute("aria-label") ||
              element.getAttribute("placeholder") ||
              element.textContent,
          );
          return exact ? value === texts[0] : texts.every((text) => value.includes(text));
        });
        if (pick === "smallest") hits.sort((a, b) => area(a) - area(b));
        hit = hits[nth];
      }
      if (!hit) return null;
      const box = hit.getBoundingClientRect();
      const round = (value) => Math.round(value * 10) / 10;
      return {
        x: round(box.x),
        y: round(box.y),
        width: round(box.width),
        height: round(box.height),
      };
    },
    selector,
    text,
    pick,
    exact,
    nth,
  );
}

/** Every page-one item's box by item ID, for tiles that fly between slots. */
function itemBoxes(page) {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll(".inventory-grid [data-item-id]")].map((element) => {
        const box = element.getBoundingClientRect();
        return [
          element.getAttribute("data-item-id"),
          {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            label: element.getAttribute("aria-label"),
          },
        ];
      }),
    ),
  );
}

/** Which flows go where, at what size; `keep` limits a set to certain snaps. */
const SETS = {
  video: { dir: VIDEO, prefix: "", width: 1440, height: 900, flows: Object.keys(FLOWS) },
  // The recap tiles: a narrower layout drawn larger, so small tiles stay legible.
  // Same 2880x1800 pixels as the video captures.
  tiles: {
    dir: VIDEO,
    prefix: "tile-",
    width: 1028,
    height: 643,
    scale: 2.8,
    flows: ["crosshair", "sounds", "news"],
    keep: ["crosshair", "crosshair-weapons", "sounds", "mods-sounds", "welcome", "comfig-vanilla"],
  },
  readme: {
    dir: README,
    prefix: "screen-",
    width: 1280,
    height: 800,
    flows: ["inventory", "profiles", "crosshair", "sounds"],
    keep: ["compare", "crosshair-circle", "sounds", "inv-hover"],
  },
};

const only = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const setName = process.argv.find((arg) => arg.startsWith("--set="))?.slice(6) ?? "video";
const set = SETS[setName];
mkdirSync(set.dir, { recursive: true });

const targetsFile = path.join(VIDEO, "targets.json");
const targets =
  setName === "video" && existsSync(targetsFile)
    ? JSON.parse(readFileSync(targetsFile, "utf8"))
    : {};

const browser = await puppeteer.launch({ executablePath: CHROME });
try {
  for (const flow of set.flows) {
    if (only.length > 0 && !only.includes(flow)) continue;
    const page = await browser.newPage();
    // Pending drafts guard navigation with "Leave site?"; captures always leave.
    page.on("dialog", (dialog) => void dialog.accept());
    await page.setViewport({
      width: set.width,
      height: set.height,
      deviceScaleFactor: set.scale ?? 2,
    });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    // Keep third-party art out. (Request interception would also stall the cfg
    // analysis worker, so block by URL instead.)
    const cdp = await page.createCDPSession();
    await cdp.send("Network.enable");
    await cdp.send("Network.setBlockedURLs", { urls: REMOTE_ART });
    const snap = async (
      name,
      { park: parkPointer = true, hideItems = false, hide = null } = {},
    ) => {
      if (set.keep && !set.keep.includes(name)) return;
      if (parkPointer) await park(page);
      const css = hideItems ? HIDE_ITEMS : hide;
      const style = css ? await page.addStyleTag({ content: css }) : null;
      if (style) await sleep(150);
      const file = path.join(set.dir, `${set.prefix}${name}.png`);
      await page.screenshot({ path: file });
      console.log(`captured ${path.relative(promo, file)}`);
      if (style) await style.evaluate((element) => element.remove());
      if (setName !== "video") return;
      if (MARKS[name]) {
        targets[name] = {};
        for (const [mark, query] of Object.entries(MARKS[name])) {
          const box = await measure(page, query);
          if (!box) throw new Error(`no element for mark ${name}.${mark}`);
          targets[name][mark] = box;
        }
      }
      if (name === "files") {
        targets["files-lines"] = await page.evaluate(() =>
          [...document.querySelectorAll(".cm-line")].map((line) => {
            const box = line.getBoundingClientRect();
            return { x: box.x, y: box.y, width: box.width, height: box.height };
          }),
        );
      }
      if (name.startsWith("inv-") && !css) targets[`${name}-items`] = await itemBoxes(page);
    };
    try {
      await FLOWS[flow](page, snap);
    } catch (error) {
      console.error(`FAILED ${flow}: ${error.message}`);
      process.exitCode = 1;
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  if (setName === "video") writeFileSync(targetsFile, `${JSON.stringify(targets, null, 2)}\n`);
}
