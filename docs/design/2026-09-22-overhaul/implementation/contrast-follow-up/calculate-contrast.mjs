import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

// Inputs are captured getComputedStyle values from the live browser DOM.
// No tokens are substituted for those observations. Colors are unpremultiplied sRGB.
function color(value) {
  const match = value.match(/^rgba?\(([^)]+)\)$/);
  if (match) {
    const parts = match[1].split(/[ ,/]+/).map(Number);
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255, parts[3] ?? 1];
  }
  const srgb = value.match(/^color\(srgb ([^)]+)\)$/);
  if (srgb) {
    const parts = srgb[1].split(/[ /]+/).map(Number);
    return [parts[0], parts[1], parts[2], parts[3] ?? 1];
  }
  const oklab = value.match(/^oklab\(([^)]+)\)$/);
  if (oklab) {
    // Chrome serializes Tailwind's color-mix alpha backgrounds in Oklab.
    // Oklab -> linear sRGB -> encoded sRGB, before source-over compositing.
    const [light, a, b, alpha = 1] = oklab[1].split(/[ /]+/).map(Number);
    const l = (light + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (light - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (light - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const channels = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ].map((v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
    if (channels.some((v) => v < -0.000001 || v > 1.000001)) {
      throw new Error(`Out-of-gamut color requires separate browser evidence: ${value}`);
    }
    return [...channels.map((v) => Math.min(1, Math.max(0, v))), alpha];
  }
  throw new Error(`Unmodeled computed color: ${value}`);
}

function over(front, back) {
  const alpha = front[3] + back[3] * (1 - front[3]);
  if (alpha === 0) return [0, 0, 0, 0];
  return [
    ...front.slice(0, 3).map((c, i) => (c * front[3] + back[i] * back[3] * (1 - front[3])) / alpha),
    alpha,
  ];
}

// Leaf -> root is needed for CSS group opacity: compose the child result over
// each ancestor's background, then apply that element's opacity to the group.
function paint(sample, text) {
  let pixel = text ? color(sample.style.color) : [0, 0, 0, 0];
  if (sample.pseudo && text) pixel[3] *= Number(sample.style.opacity);
  for (const ancestor of sample.ancestors) {
    pixel = over(pixel, color(ancestor.style.backgroundColor));
    pixel[3] *= Number(ancestor.style.opacity);
  }
  // All accepted samples have an opaque painted app surface. White is only a
  // browser-canvas fallback, and use of it is disclosed by rootAlpha below.
  return { rgba: over(pixel, [1, 1, 1, 1]), rootAlpha: pixel[3] };
}

function luminance(c) {
  const linear = c
    .slice(0, 3)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function ratio(a, b) {
  const y1 = luminance(a);
  const y2 = luminance(b);
  return (Math.max(y1, y2) + 0.05) / (Math.min(y1, y2) + 0.05);
}

function hex(c) {
  return `#${c
    .slice(0, 3)
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

// Basic numerical guards; these do not replace the visual evidence.
assert.equal(ratio([0, 0, 0, 1], [1, 1, 1, 1]), 21);
assert.equal(ratio([1, 1, 1, 1], [1, 1, 1, 1]), 1);
assert.deepEqual(over([1, 0, 0, 0.5], [0, 0, 0, 1]), [0.5, 0, 0, 1]);
assert.equal(hex(color("oklab(1 0 0)")), "#ffffff");
assert.equal(hex(color("oklab(0 0 0)")), "#000000");

const records = JSON.parse(
  await readFile(new URL("raw-observations.json", import.meta.url), "utf8"),
);
const results = records.flatMap((record) =>
  record.samples.map((sample) => {
    const unsupported = sample.ancestors.flatMap((ancestor) => {
      const s = ancestor.style;
      return [
        s.backgroundImage !== "none" && `${ancestor.tag}: background image`,
        s.filter !== "none" && `${ancestor.tag}: filter`,
        s.backdropFilter !== "none" && `${ancestor.tag}: backdrop filter`,
        s.mixBlendMode !== "normal" && `${ancestor.tag}: blend mode`,
      ].filter(Boolean);
    });
    const foreground = paint(sample, true);
    const background = paint(sample, false);
    const contrast = ratio(foreground.rgba, background.rgba);
    return {
      record: record.id,
      screenshot: record.screenshot,
      id: sample.id,
      text: sample.text,
      selector: sample.selector,
      pseudo: sample.pseudo ?? null,
      viewport: record.viewport,
      fontSize: sample.style.fontSize,
      fontWeight: sample.style.fontWeight,
      foreground: hex(foreground.rgba),
      background: hex(background.rgba),
      foregroundRgba: foreground.rgba,
      backgroundRgba: background.rgba,
      contrast,
      threshold: 4.5,
      passes: contrast >= 4.5 && unsupported.length === 0 && sample.intersectsViewport,
      intersectsViewport: sample.intersectsViewport,
      canvasFallbackUsed: background.rootAlpha !== 1,
      unsupported,
    };
  }),
);
await writeFile(
  new URL("contrast-results.json", import.meta.url),
  `${JSON.stringify(results, null, 2)}\n`,
);
console.table(
  results.map((r) => ({
    id: r.id,
    fg: r.foreground,
    bg: r.background,
    ratio: r.contrast.toFixed(3),
    result: r.passes ? "pass" : "REVIEW",
  })),
);
