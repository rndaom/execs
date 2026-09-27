// Captures the desktop app's browser preview for the promo video and README.
//
//   node <repo>/node_modules/vite/bin/vite.js --config tools/promo/capture/vite.config.ts
//   pnpm capture                      (both sets; pass shot names to capture a subset)
//
// Every shot drives the real interface over the app's preview fixtures at 2x,
// with the hosts of HUD and mod art blocked so no third-party artwork appears. Video captures go to public/captures (gitignored)
// with the element boxes the video frames on in public/captures/targets.json;
// README captures go to docs/media/screen-*.png.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.EXECS_CAPTURE_URL ?? "http://localhost:1433";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const promo = path.resolve(import.meta.dirname, "..");
const VIDEO = path.join(promo, "public/captures");
const README = path.resolve(promo, "../../docs/media");

const REMOTE_ART = [
  "*githubusercontent.com*",
  "*gamebanana.com*",
  "*imgur.com*",
  "*comfig.app*",
  "*tf2huds.dev*",
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

async function click(page, selector, text, options) {
  const { x, y } = await locate(page, selector, text, options);
  await page.mouse.click(x, y);
  await sleep(options?.settle ?? 450);
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
  await page.goto(`${BASE}/?preview=${state}`, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  await sleep(900);
}

/** Park the pointer where it hovers nothing, so no hover state is captured. */
async function park(page) {
  await page.mouse.move(60, 780);
  await sleep(250);
}

async function openProfiles(page) {
  await click(page, "header summary", "Profile", { settle: 500 });
}

/** A library with a few named setups, profile menu open. */
async function profiles(page) {
  await open(page, "settings-comfig");
  await openProfiles(page);
  for (const name of ["Competitive", "Casual", "Potato PC"]) {
    const { x, y } = await locate(page, "input", "Save current as");
    await page.mouse.click(x, y, { clickCount: 3 });
    await page.keyboard.type(name);
    await page.keyboard.press("Enter");
    await sleep(700);
  }
  await page.evaluate(() => document.activeElement?.blur());
}

async function compare(page) {
  await profiles(page);
  await click(page, button, "Actions for Competitive", { exact: true, settle: 400 });
  await click(page, button, "Compare with current", { settle: 1200 });
}

async function recordKey(page, action, key) {
  await click(page, "button", `Add a key for ${action}`, { settle: 300 });
  await page.keyboard.press(key);
  await sleep(600);
}

async function designShape(page, shape) {
  await open(page, "settings-crosshair");
  await click(page, "button", "Customize shape", { settle: 1000 });
  // Style labels are lower case in the DOM and capitalised by CSS.
  if (shape) await click(page, "label", shape, { exact: true, settle: 700 });
}

async function perWeapon(page, choose) {
  await open(page, "settings-viewmodels");
  if (choose) {
    await click(page, "label", "Hidden", { nth: 0, exact: true, settle: 300 });
    await click(page, "label", "Hands only", { nth: 1, exact: true, settle: 300 });
    await click(page, "label", "Hidden", { nth: 2, exact: true, settle: 300 });
  }
  await page.evaluate(() =>
    document.getElementById("viewmodel-per-weapon")?.scrollIntoView({ block: "start" }),
  );
  await sleep(600);
}

async function autoexec(page, text) {
  await open(page, "settings-files");
  await click(page, button, "autoexec.cfg", { settle: 600 });
  const editor = await locate(page, ".cm-content", "");
  await page.mouse.click(editor.x, editor.y);
  await page.keyboard.down("Control");
  await page.keyboard.press("End");
  await page.keyboard.up("Control");
  if (!text) {
    await page.evaluate(() => document.activeElement?.blur());
    return;
  }
  await page.keyboard.type(text, { delay: 4 });
  // Let the cfg analysis finish so the status bar shows its result.
  await page.waitForFunction(() => /Problems \d/.test(document.body.innerText), { timeout: 20000 });
  await sleep(600);
}

const TYPED =
  '\n// Movement\nbind "mouse4" "+jump"\nbind "q" "lastinv"\n\n// Network\ncl_interp 0.0152\ncl_cmdrate 66\ncl_updaterate 66\nrate 196608\n';

const SHOTS = {
  "profiles-menu": profiles,
  compare,
  "switch-done": async (page) => {
    await compare(page);
    await click(page, "button", "Switch to Competitive", { settle: 2600 });
  },
  "comfig-medium": (page) => open(page, "settings-comfig"),
  "comfig-high": async (page) => {
    await open(page, "settings-comfig");
    await click(page, "label", "High quality for modern systems", { settle: 900 });
  },
  binds: (page) => open(page, "settings-binds"),
  "binds-recording": async (page) => {
    await open(page, "settings-binds");
    await click(page, "button", "Add a key for Taunt", { settle: 300 });
  },
  "binds-recorded": async (page) => {
    await open(page, "settings-binds");
    await recordKey(page, "Taunt", "KeyG");
    await recordKey(page, "Reload", "KeyR");
  },
  "crosshair-designer": (page) => designShape(page),
  "crosshair-circle": (page) => designShape(page, "circle"),
  "crosshair-chevron": (page) => designShape(page, "chevron"),
  "crosshair-ring": (page) => designShape(page, "ring cross"),
  "viewmodels-scrolled": (page) => perWeapon(page, false),
  "viewmodels-weapons": (page) => perWeapon(page, true),
  sounds: (page) => open(page, "settings-sounds"),
  "sounds-used": async (page) => {
    await open(page, "settings-sounds");
    const use = await page.evaluate(() => {
      const row = [...document.querySelectorAll("[data-testid^=sounds-row-]")].find((item) =>
        item.textContent.includes("Electro"),
      );
      const box = row?.querySelector("[data-testid^=sounds-assign-]")?.getBoundingClientRect();
      return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
    });
    if (!use) throw new Error("No Use button for Electro");
    await page.mouse.click(use.x, use.y);
    await sleep(900);
  },
  "files-before": (page) => autoexec(page),
  files: (page) => autoexec(page, TYPED),
  "gameplay-sources": async (page) => {
    await open(page, "settings-gameplay");
    await click(page, "summary", "Where these values come from", { settle: 700 });
    await scrollToText(page, "summary", "Where these values come from", 120);
  },
  "restore-points": async (page) => {
    await open(page, "settings-comfig");
    await openProfiles(page);
    await click(page, button, "Actions for Main", { exact: true, settle: 400 });
    await click(page, button, "Restore points", { settle: 1200 });
  },
  "app-health": async (page) => {
    await open(page, "settings-comfig");
    await click(page, button, "App settings", { settle: 1000 });
    const health = await locate(page, "h2, h3", "Health");
    await page.mouse.move(health.x, health.y);
    await page.mouse.wheel({ deltaY: 520 });
    await sleep(700);
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
    high: { selector: "label", text: ["High quality for modern systems"] },
  },
  binds: {
    taunt: { selector: "div", text: ["Taunt"], pick: "smallest" },
    reload: { selector: "div", text: ["Reload"], pick: "smallest" },
  },
  "crosshair-designer": {
    circle: { selector: "label", text: ["circle"], exact: true },
    chevron: { selector: "label", text: ["chevron"], exact: true },
    ring: { selector: "label", text: ["ring cross"], exact: true },
  },
  "viewmodels-weapons": {
    scattergun: { selector: "*", text: ["Scattergun", "Hands only"], pick: "climb" },
    forceANature: { selector: "*", text: ["Force-a-Nature", "Hands only"], pick: "climb" },
    shortstop: { selector: "*", text: ["Shortstop", "Hands only"], pick: "climb" },
    toolbar: { selector: "*", text: ["Every class", "Review and build"], pick: "climb" },
  },
  sounds: {
    use: { selector: "[data-testid^=sounds-assign-hit-]", text: ["Electro"] },
  },
  "sounds-used": {
    hitToggle: { selector: "[role=switch]", text: [] },
  },
  files: {
    change: { selector: "[data-testid=settings-tab-files-changed]", text: [] },
  },
};

async function measure(page, { selector, text, pick = "first", exact = false }) {
  return page.evaluate(
    (selector, texts, pick, exact) => {
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
        hit = hits[0];
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
  );
}

/** Which shots go where, at what size. */
const SETS = {
  video: { dir: VIDEO, prefix: "", width: 1440, height: 900, shots: Object.keys(SHOTS) },
  readme: {
    dir: README,
    prefix: "screen-",
    width: 1280,
    height: 800,
    shots: [
      "comfig-medium",
      "compare",
      "viewmodels-weapons",
      "crosshair-designer",
      "files",
      "app-health",
    ],
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
  for (const name of set.shots) {
    if (only.length > 0 && !only.includes(name)) continue;
    const page = await browser.newPage();
    await page.setViewport({ width: set.width, height: set.height, deviceScaleFactor: 2 });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    // Keep third-party art out: the preview fixtures load HUD and mod images
    // from these hosts. (Request interception would also stall the cfg
    // analysis worker, so block by URL instead.)
    const cdp = await page.createCDPSession();
    await cdp.send("Network.enable");
    await cdp.send("Network.setBlockedURLs", { urls: REMOTE_ART });
    try {
      await SHOTS[name](page);
      await park(page);
      const file = path.join(set.dir, `${set.prefix}${name}.png`);
      await page.screenshot({ path: file });
      console.log(`captured ${path.relative(promo, file)}`);
      if (setName !== "video") continue;
      if (MARKS[name]) {
        targets[name] = {};
        for (const [mark, query] of Object.entries(MARKS[name])) {
          const box = await measure(page, query);
          if (box) targets[name][mark] = box;
          else throw new Error(`no element for mark ${mark}`);
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
    } catch (error) {
      console.error(`FAILED ${name}: ${error.message}`);
      process.exitCode = 1;
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  if (setName === "video") writeFileSync(targetsFile, `${JSON.stringify(targets, null, 2)}\n`);
}
