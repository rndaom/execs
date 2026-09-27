// The promo soundtrack: an original spy-funk cue, synthesized from scratch in
// plain JavaScript so there is nothing sampled and nothing to license. It
// follows src/timeline.json bar for bar, so the video's cuts, clicks and dot
// pops land on the music. Deterministic: the same script writes the same file.
//
//   node music/compose.mjs [out.wav]      (default public/local/soundtrack.wav)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const timeline = JSON.parse(readFileSync(path.join(here, "../src/timeline.json"), "utf8"));
const outFile = process.argv[2] ?? path.join(here, "../public/local/soundtrack.wav");

const SR = 48000;
const BEAT = 60 / timeline.bpm;
const TAIL = 1.5;
const LENGTH = Math.ceil((timeline.bars * 4 * BEAT + TAIL) * SR);

/** Seconds at a bar and beat (both zero-based; beats may be fractional). */
const at = (bar, beat = 0) => (bar * 4 + beat) * BEAT;
const sixteenth = BEAT / 4;
const event = (name) => at(...timeline.events[name]);
const midi = (note) => 440 * 2 ** ((note - 69) / 12);

// ---------------------------------------------------------------- buses

function bus() {
  return { l: new Float32Array(LENGTH), r: new Float32Array(LENGTH) };
}
const dry = bus();
const verb = bus();

/**
 * Mix a mono voice into the dry bus (and optionally the reverb send) at
 * `start` seconds. `pan` runs -1 (left) to 1 (right), equal power.
 */
function place(samples, start, { gain = 1, pan = 0, send = 0 } = {}) {
  const offset = Math.round(start * SR);
  const angle = ((pan + 1) * Math.PI) / 4;
  const gl = Math.cos(angle) * gain;
  const gr = Math.sin(angle) * gain;
  for (let i = 0; i < samples.length; i += 1) {
    const n = offset + i;
    if (n < 0 || n >= LENGTH) continue;
    const value = samples[i];
    dry.l[n] += value * gl;
    dry.r[n] += value * gr;
    if (send) {
      verb.l[n] += value * gl * send;
      verb.r[n] += value * gr * send;
    }
  }
}

// ---------------------------------------------------------------- helpers

let seed = 0x5eed;
function random() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const noise = () => random() * 2 - 1;

/** Topology-preserving state-variable filter; returns low, band and high. */
function svf() {
  let ic1 = 0;
  let ic2 = 0;
  return (input, cutoff, q = Math.SQRT1_2) => {
    const g = Math.tan((Math.PI * Math.min(cutoff, SR * 0.45)) / SR);
    const k = 1 / q;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = input - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    return { low: v2, band: v1, high: input - k * v1 - v2 };
  };
}

/** Band-limited sawtooth (PolyBLEP). */
function saw() {
  let phase = random();
  return (freq) => {
    const dt = freq / SR;
    phase += dt;
    if (phase >= 1) phase -= 1;
    let value = 2 * phase - 1;
    if (phase < dt) {
      const t = phase / dt;
      value -= t + t - t * t - 1;
    } else if (phase > 1 - dt) {
      const t = (phase - 1) / dt;
      value -= t * t + t + t + 1;
    }
    return value;
  };
}

/** Linear attack, exponential-ish release envelope over a held note. */
function adsr(t, hold, { a = 0.005, d = 0.1, s = 0.7, r = 0.08 }) {
  let level;
  if (t < a) level = t / a;
  else if (t < a + d) level = 1 - (1 - s) * ((t - a) / d);
  else level = s;
  if (t > hold) level *= Math.max(0, 1 - (t - hold) / r);
  return level;
}

const buffer = (seconds) => new Float32Array(Math.ceil(seconds * SR));

// ---------------------------------------------------------------- drums

function kick(level = 1) {
  const out = buffer(0.5);
  let phase = 0;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    const freq = 46 + 95 * Math.exp(-t / 0.028);
    phase += (2 * Math.PI * freq) / SR;
    const body = Math.sin(phase) * Math.exp(-t / 0.3);
    const click = t < 0.004 ? noise() * (1 - t / 0.004) * 0.35 : 0;
    out[i] = Math.tanh((body + click) * 1.6) * level;
  }
  return out;
}

function snare(level = 1) {
  const out = buffer(0.4);
  const filter = svf();
  let phase = 0;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    phase += (2 * Math.PI * (190 + 40 * Math.exp(-t / 0.01))) / SR;
    const body = Math.sin(phase) * Math.exp(-t / 0.055) * 0.7;
    const hiss = filter(noise(), 2400, 0.6).band * Math.exp(-t / 0.13) * 1.6;
    out[i] = (body + hiss) * level;
  }
  return out;
}

function hat(open = false, level = 1) {
  const out = buffer(open ? 0.35 : 0.08);
  const filter = svf();
  const decay = open ? 0.16 : 0.028;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    out[i] = filter(noise(), 8200, 0.9).high * Math.exp(-t / decay) * level;
  }
  return out;
}

/** Hand drum: a pitched membrane with a short slap. */
function bongo(freq, level = 1) {
  const out = buffer(0.25);
  let phase = 0;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    phase += (2 * Math.PI * freq * (1 + 0.35 * Math.exp(-t / 0.012))) / SR;
    const slap = t < 0.006 ? noise() * (1 - t / 0.006) * 0.4 : 0;
    out[i] = (Math.sin(phase) * Math.exp(-t / 0.085) + slap) * level;
  }
  return out;
}

/** Wood block: the tick under each kinetic word. */
function block(freq = 1150, level = 1) {
  const out = buffer(0.12);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    const tone = Math.sin(2 * Math.PI * freq * t) + 0.5 * Math.sin(2 * Math.PI * freq * 1.58 * t);
    out[i] = tone * Math.exp(-t / 0.018) * level;
  }
  return out;
}

function crash(level = 1) {
  const out = buffer(2.6);
  const a = svf();
  const b = svf();
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    const n = noise();
    out[i] =
      (a(n, 5200, 0.7).high * 0.8 + b(n, 9000, 1.4).band * 0.5) *
      Math.exp(-t / 0.9) *
      Math.min(1, t / 0.002) *
      level;
  }
  return out;
}

function boom(level = 1) {
  const out = buffer(1.8);
  let phase = 0;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    phase += (2 * Math.PI * (38 + 30 * Math.exp(-t / 0.08))) / SR;
    out[i] = Math.sin(phase) * Math.exp(-t / 0.7) * Math.min(1, t / 0.003) * level;
  }
  return out;
}

function riser(seconds, level = 1) {
  const out = buffer(seconds);
  const filter = svf();
  for (let i = 0; i < out.length; i += 1) {
    const p = i / out.length;
    const cutoff = 300 * 22 ** p;
    out[i] = filter(noise(), cutoff, 2.2).band * p * p * level;
  }
  return out;
}

// ---------------------------------------------------------------- sfx

/** The dot's pop: a quick upward bubble, the sound of a change landing. */
function pop(level = 1) {
  const out = buffer(0.2);
  let phase = 0;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    const freq = 540 + 900 * (1 - Math.exp(-t / 0.018));
    phase += (2 * Math.PI * freq) / SR;
    const body = Math.sin(phase) * Math.exp(-t / 0.05) * Math.min(1, t / 0.0015);
    const low = Math.sin(2 * Math.PI * 220 * t) * Math.exp(-t / 0.02) * 0.4;
    out[i] = (body + low) * level;
  }
  return out;
}

function click(level = 1) {
  const out = buffer(0.03);
  const filter = svf();
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    out[i] =
      (filter(noise(), 3200, 1.2).band * 1.5 + Math.sin(2 * Math.PI * 2600 * t) * 0.4) *
      Math.exp(-t / 0.004) *
      level;
  }
  return out;
}

/** Struck metal: inharmonic partials for each Refined Metal picked up. */
function clink(base, level = 1) {
  const out = buffer(0.45);
  const partials = [
    [1, 1, 0.16],
    [2.76, 0.55, 0.09],
    [5.4, 0.3, 0.05],
    [8.93, 0.18, 0.03],
  ];
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    let value = 0;
    for (const [ratio, gain, decay] of partials) {
      value += Math.sin(2 * Math.PI * base * ratio * t) * gain * Math.exp(-t / decay);
    }
    const strike = t < 0.002 ? noise() * (1 - t / 0.002) * 0.5 : 0;
    out[i] = (value * 0.6 + strike) * Math.min(1, t / 0.0008) * level;
  }
  return out;
}

/** A small bell, for opening an item's panel and for the reveal's sparkle. */
function chime(note, level = 1) {
  const out = buffer(1.6);
  const base = midi(note);
  const partials = [
    [1, 1, 0.9],
    [2, 0.4, 0.5],
    [2.76, 0.25, 0.35],
    [5.4, 0.12, 0.16],
  ];
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    let value = 0;
    for (const [ratio, gain, decay] of partials) {
      value += Math.sin(2 * Math.PI * base * ratio * t) * gain * Math.exp(-t / decay);
    }
    out[i] = value * 0.5 * Math.min(1, t / 0.002) * level;
  }
  return out;
}

/** Air moving: band-passed noise sweeping up, for items flying into order. */
function whoosh(seconds, level = 1) {
  const out = buffer(seconds);
  const filter = svf();
  for (let i = 0; i < out.length; i += 1) {
    const p = i / out.length;
    const cutoff = 500 * 9 ** p;
    out[i] = filter(noise(), cutoff, 1.4).band * Math.sin(Math.PI * p) ** 1.5 * level;
  }
  return out;
}

/** A soft burst, for an item dissolving into dots. */
function poof(level = 1) {
  const out = buffer(0.45);
  const filter = svf();
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    const cutoff = 2600 * Math.exp(-t / 0.12) + 250;
    const air = filter(noise(), cutoff, 0.8).low * Math.exp(-t / 0.11);
    const thump =
      Math.sin(2 * Math.PI * (110 * Math.exp(-t / 0.05) + 55) * t) * Math.exp(-t / 0.06);
    out[i] = (air * 1.4 + thump * 0.5) * Math.min(1, t / 0.003) * level;
  }
  return out;
}

/** Picking an item up. */
function lift(level = 1) {
  const out = buffer(0.12);
  let phase = 0;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    phase += (2 * Math.PI * (420 + 520 * Math.min(1, t / 0.07))) / SR;
    out[i] = Math.sin(phase) * Math.exp(-t / 0.045) * Math.min(1, t / 0.004) * level;
  }
  return out;
}

/** Setting it down. */
function thunk(level = 1) {
  const out = buffer(0.2);
  let phase = 0;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    phase += (2 * Math.PI * (80 + 120 * Math.exp(-t / 0.02))) / SR;
    const knock = t < 0.004 ? noise() * (1 - t / 0.004) * 0.4 : 0;
    out[i] = (Math.sin(phase) * Math.exp(-t / 0.07) + knock) * level;
  }
  return out;
}

/** A crash played backwards: the breath before a drop. */
function swell(seconds, level = 1) {
  const hit = crash(1);
  const out = buffer(seconds);
  for (let i = 0; i < out.length; i += 1) {
    const source = hit[out.length - 1 - i] ?? 0;
    out[i] = source * (i / out.length) ** 1.5 * level;
  }
  return out;
}

function shaker(level = 1) {
  const out = buffer(0.06);
  const filter = svf();
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    out[i] =
      filter(noise(), 7000, 0.8).high * Math.exp(-t / 0.018) * Math.min(1, t / 0.004) * level;
  }
  return out;
}

// ---------------------------------------------------------------- instruments

/** Brass section note: three detuned saws, a filter swell and a small scoop. */
function brass(note, seconds, level = 1, bright = 1) {
  const out = buffer(seconds + 0.12);
  const voices = [-7, 0, 6].map((cents) => ({ osc: saw(), ratio: 2 ** (cents / 1200) }));
  const filter = svf();
  const base = midi(note);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    const scoop = 2 ** ((-45 * Math.exp(-t / 0.025)) / 1200);
    const vibrato = 1 + (t > 0.25 ? 0.004 * Math.sin(2 * Math.PI * 5.5 * t) : 0);
    let value = 0;
    for (const voice of voices) value += voice.osc(base * voice.ratio * scoop * vibrato);
    const env = adsr(t, seconds, { a: 0.012, d: 0.12, s: 0.72, r: 0.09 });
    const cutoff =
      base * (1.6 + bright * 5.5 * Math.min(1, t / 0.03) * Math.exp(-t / 0.22) + bright * 1.2);
    out[i] = Math.tanh(filter(value / 3, cutoff, 0.9).low * 1.8) * env * level;
  }
  return out;
}

/** A plucked, slightly driven twang guitar (Karplus-Strong with a pick-position comb). */
function guitar(note, seconds, level = 1, { tremolo = 0 } = {}) {
  const out = buffer(seconds + 0.35);
  const freq = midi(note);
  const period = SR / freq;
  const size = Math.floor(period);
  const frac = period - size;
  const line = new Float32Array(size + 2);
  const pick = svf();
  for (let i = 0; i < line.length; i += 1) line[i] = pick(noise(), freq * 9, 0.7).low;
  let index = 0;
  let last = 0;
  const decay = 0.9965;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    const a = line[index];
    const b = line[(index + 1) % line.length];
    const sample = a + (b - a) * frac;
    const next = (sample + last) * 0.5 * decay;
    last = sample;
    line[index] = next;
    index = (index + 1) % size;
    const mute = t > seconds ? Math.max(0, 1 - (t - seconds) / 0.3) : 1;
    const trem = tremolo ? 0.55 + 0.45 * Math.cos(2 * Math.PI * tremolo * t) : 1;
    out[i] = Math.tanh(sample * 2.2) * mute * trem * level;
  }
  return out;
}

function bass(note, seconds, level = 1) {
  const out = buffer(seconds + 0.06);
  const osc = saw();
  const filter = svf();
  const freq = midi(note);
  let sub = 0;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    sub += (2 * Math.PI * freq) / SR;
    const env = adsr(t, seconds, { a: 0.003, d: 0.2, s: 0.55, r: 0.04 });
    const cutoff = 260 + 1400 * Math.exp(-t / 0.06);
    const tone = filter(osc(freq), cutoff, 1.1).low + Math.sin(sub) * 0.6;
    out[i] = Math.tanh(tone * 1.4) * env * level;
  }
  return out;
}

function pad(notes, seconds, level = 1) {
  const out = buffer(seconds + 1.2);
  const voices = notes.flatMap((note) =>
    [-9, 8].map((cents) => ({ osc: saw(), freq: midi(note) * 2 ** (cents / 1200) })),
  );
  const filter = svf();
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    let value = 0;
    for (const voice of voices) value += voice.osc(voice.freq);
    const env = adsr(t, seconds, { a: 0.9, d: 0.1, s: 1, r: 1.1 });
    out[i] = filter(value / voices.length, 1100, 0.6).low * env * level;
  }
  return out;
}

// ---------------------------------------------------------------- harmony

const CHORDS = {
  Dm: {
    root: 38,
    bass: [0, 0, 12, 0, 7, 10, 12, 7],
    stab: [62, 65, 69, 74],
    pad: [50, 57, 62, 65],
  },
  Bb: { root: 34, bass: [0, 0, 12, 0, 7, 9, 12, 7], stab: [62, 65, 70, 74], pad: [46, 53, 62, 65] },
  Gm: {
    root: 31,
    bass: [0, 0, 12, 0, 7, 10, 12, 7],
    stab: [62, 67, 70, 74],
    pad: [43, 55, 62, 67],
  },
  A7: {
    root: 33,
    bass: [0, 0, 12, 0, 7, 10, 12, 4],
    stab: [61, 64, 67, 69],
    pad: [45, 55, 61, 64],
  },
  C: { root: 36, bass: [0, 0, 12, 0, 7, 10, 12, 7], stab: [60, 64, 67, 72], pad: [48, 55, 60, 64] },
  // The finale moves up a step to E minor, and the crafted hat lands on E major.
  Em: {
    root: 40,
    bass: [0, 0, 12, 0, 7, 10, 12, 7],
    stab: [64, 67, 71, 76],
    pad: [52, 59, 64, 67],
  },
  C6: { root: 36, bass: [0, 0, 12, 0, 7, 9, 12, 7], stab: [64, 67, 72, 76], pad: [48, 55, 64, 67] },
  Am: {
    root: 33,
    bass: [0, 0, 12, 0, 7, 10, 12, 7],
    stab: [64, 69, 72, 76],
    pad: [45, 57, 64, 69],
  },
  B7: {
    root: 35,
    bass: [0, 0, 12, 0, 7, 10, 12, 4],
    stab: [63, 66, 69, 71],
    pad: [47, 57, 63, 66],
  },
  E: { root: 40, bass: [0, 0, 12, 0, 7, 4, 12, 7], stab: [64, 68, 71, 76], pad: [52, 59, 64, 68] },
};
/** One chord per bar from the drop to the outro; bar 15 is the breakdown. */
const PROGRESSION = {
  4: "Dm",
  5: "Bb",
  6: "Gm",
  7: "A7",
  8: "Dm",
  9: "Bb",
  10: "Gm",
  11: "A7",
  12: "Dm",
  13: "Bb",
  14: "A7",
  16: "Em",
  17: "C6",
  18: "Am",
  19: "B7",
  20: "Em",
  21: "E",
  22: "C6",
  23: "Am",
  24: "B7",
};
const BASS_STEPS = [0, 3, 4, 6, 8, 10, 12, 14];
const BASS_LENGTHS = [2, 1, 2, 2, 2, 2, 2, 2];
const BREAKDOWN = 15;
const OUTRO = timeline.events.outro[0];

// ---------------------------------------------------------------- arrangement

// Intro: a held pad and the dot's first pop.
place(pad([50, 57, 62, 65, 69], at(2) - 0.4, 0.5), at(0), { gain: 0.5, send: 0.4 });
for (let beat = 2; beat < 8; beat += 0.5) {
  place(hat(false, beat % 1 ? 0.35 : 0.55), at(0, beat), { gain: 0.16, pan: 0.3 });
}
place(guitar(62, 1.2, 1), event("wordmark"), { gain: 0.3, pan: -0.1, send: 0.5 });

// Bar 2: the nine class emblems, one pluck each, climbing into bar 3.
const CLASS_NOTES = [62, 65, 69, 72, 74, 77, 81, 79, 74];
CLASS_NOTES.forEach((note, i) => {
  place(guitar(note, 0.4, 1), at(1, i * 0.5), { gain: 0.34, pan: -0.5 + i * 0.12, send: 0.4 });
});
place(kick(0.7), at(1, 0), { gain: 0.6 });
place(kick(0.7), at(1, 2), { gain: 0.6 });

// Bar 3: the kinetic words ride a driving bass and a wood block per word.
place(pad([46, 53, 62, 65], 2 * BEAT, 0.5), at(2, 0), { gain: 0.45, send: 0.3 });
place(pad([48, 55, 60, 64], 2 * BEAT, 0.5), at(2, 2), { gain: 0.45, send: 0.3 });
for (let i = 0; i < 8; i += 1) {
  const root = i < 4 ? 34 : 36;
  place(bass(root, sixteenth * 1.6, 1), at(2, i * 0.5), { gain: 0.42 });
  // One tick per word; the first eighth belongs to the ninth class pluck.
  if (i > 0)
    place(block(i % 2 ? 1450 : 1150, 1), at(2, i * 0.5), { gain: 0.2, pan: i % 2 ? 0.35 : -0.35 });
  if (i % 2 === 0) place(kick(0.8), at(2, i * 0.5), { gain: 0.7 });
}
for (const [beat, chord] of [
  [0, "Bb"],
  [2, "C"],
]) {
  for (const note of CHORDS[chord].stab)
    place(brass(note, 0.18, 0.8), at(2, beat), { gain: 0.1, send: 0.2 });
}

// Bar 4: "In one profile." A7 hit, the dot pops, a roll and riser, then a breath.
for (const note of CHORDS.A7.stab) place(brass(note, 0.35, 1), at(3, 0), { gain: 0.12, send: 0.3 });
place(kick(1), at(3, 0), { gain: 0.8 });
place(bass(33, 0.4, 1), at(3, 0), { gain: 0.45 });
for (let step = 0; step < 10; step += 1) {
  const beat = 1 + step * 0.25;
  place(snare(0.35 + 0.65 * (step / 9)), at(3, beat), { gain: 0.32, pan: 0.05, send: 0.15 });
}
place(riser(2.5 * BEAT, 1), at(3, 1), { gain: 0.18, send: 0.3 });
place(pad([45, 55, 61, 64], 2.4 * BEAT, 0.5), at(3, 0), { gain: 0.4, send: 0.3 });

// The drops: the app arrives on bar 4, the backpack on bar 16.
for (const bar of [4, 16]) {
  place(crash(1), at(bar), { gain: 0.3, pan: 0.2, send: 0.2 });
  place(boom(1), at(bar), { gain: 0.42 });
}

// The groove, both keys.
for (const [barText, name] of Object.entries(PROGRESSION)) {
  const bar = Number(barText);
  const chord = CHORDS[name];
  const finale = bar >= 16;
  const fill = bar === 14 || bar === OUTRO - 1;
  for (let step = 0; step < 16; step += 1) {
    const beat = step / 4;
    if ([0, 7, 10].includes(step) && !(fill && step > 11))
      place(kick(1), at(bar, beat), { gain: 0.6 });
    if (step === 4 || (step === 12 && !fill))
      place(snare(1), at(bar, beat), { gain: 0.4, send: 0.12 });
    if (step === 15 && !fill) place(snare(0.3), at(bar, beat), { gain: 0.2 });
    const accent = step % 4 === 0 ? 0.7 : step % 2 === 0 ? 0.5 : 0.3;
    if (step === 14) place(hat(true, 0.6), at(bar, beat), { gain: 0.14, pan: 0.35 });
    else place(hat(false, accent), at(bar, beat), { gain: 0.17, pan: 0.35 });
    // The finale adds a shaker on the off sixteenths for lift.
    if (finale && step % 2 === 1) place(shaker(0.8), at(bar, beat), { gain: 0.1, pan: -0.3 });
    if ([2, 3, 9, 13].includes(step))
      place(bongo(step === 9 ? 240 : 330, 0.8), at(bar, beat), {
        gain: 0.16,
        pan: -0.45,
        send: 0.1,
      });
    if ([6, 11].includes(step))
      place(bongo(220, 0.7), at(bar, beat), { gain: 0.14, pan: -0.55, send: 0.1 });
  }
  BASS_STEPS.forEach((step, i) => {
    place(
      bass(chord.root + chord.bass[i], BASS_LENGTHS[i] * sixteenth * 0.85, 1),
      at(bar, step / 4),
      { gain: 0.33 },
    );
  });
  const heavy = bar <= 7 || bar === 16 || bar === 21;
  const stabs = heavy
    ? [
        [0, 2],
        [6, 1.5],
        [14, 1.5],
      ]
    : bar === 13 || bar === 14
      ? []
      : [
          [6, 1],
          [14, 1],
        ];
  for (const [step, length] of stabs) {
    chord.stab.forEach((note, voice) => {
      place(brass(note, length * sixteenth, 1, step === 0 ? 1.2 : 0.9), at(bar, step / 4), {
        gain: 0.11,
        pan: -0.35 + voice * 0.25,
        send: 0.25,
      });
    });
  }
  if (fill) {
    for (let step = 12; step < 16; step += 1) {
      place(snare(0.5 + step * 0.03), at(bar, step / 4), { gain: 0.34 });
      place(bongo(180 - (step - 12) * 20, 1), at(bar, step / 4), { gain: 0.24, pan: -0.2 });
    }
  }
}

// "New in 0.2.0": one brass hit per tile, climbing.
const TILE_VOICINGS = [
  [58, 62, 65, 70],
  [62, 65, 70, 74],
  [65, 70, 74, 77],
  [70, 74, 77, 82],
  [61, 64, 69, 73],
  [64, 69, 73, 76],
];
timeline.tiles.forEach(([bar, beat], i) => {
  TILE_VOICINGS[i].forEach((note, voice) => {
    place(brass(note, 0.22, 1, 1.1), at(bar, beat), {
      gain: 0.12,
      pan: -0.35 + voice * 0.25,
      send: 0.25,
    });
  });
});

// Bar 15, "And now, your backpack": the band drops out over B7, the dot pops,
// splits into a shimmer of plucks and the room breathes in before the drop.
for (const note of CHORDS.B7.stab)
  place(brass(note, 0.3, 1), at(BREAKDOWN, 0), { gain: 0.12, send: 0.35 });
place(kick(1), at(BREAKDOWN, 0), { gain: 0.8 });
place(bass(35, 3.6 * BEAT, 0.9), at(BREAKDOWN, 0), { gain: 0.34 });
place(pad(CHORDS.B7.pad, 3.2 * BEAT, 0.5), at(BREAKDOWN, 0), { gain: 0.45, send: 0.4 });
place(guitar(83, 1.4, 1), event("backpackDot"), { gain: 0.26, pan: 0.15, send: 0.55 });
for (let step = 0; step < 12; step += 1) {
  const beat = 2 + step * 0.125;
  place(snare(0.25 + 0.75 * (step / 11)), at(BREAKDOWN, beat), { gain: 0.26, send: 0.15 });
}
place(riser(3 * BEAT, 1), at(BREAKDOWN, 1), { gain: 0.2, send: 0.3 });
[71, 75, 78, 81, 83, 87, 90, 93].forEach((note, i) => {
  place(guitar(note, 0.3, 1), event("split") + i * (BEAT / 8), {
    gain: 0.2,
    pan: -0.6 + i * 0.17,
    send: 0.5,
  });
});
place(swell(BEAT / 2, 1), at(16) - BEAT / 2, { gain: 0.3, send: 0.3 });

// Bar 16: every item lands, a rising glissando across the backpack.
[64, 67, 69, 71, 74, 76, 79, 81, 83, 86, 88, 91, 93, 95].forEach((note, i) => {
  place(guitar(note, 0.35, 1), event("inventory") + i * 0.05, {
    gain: 0.16,
    pan: -0.7 + i * 0.1,
    send: 0.4,
  });
});

// The lead: a surf-guitar line over the features, then a second one in E.
const LEAD = {
  8: [
    [0, 74, 3],
    [3, 69, 1],
    [4, 74, 2],
    [6, 77, 2],
    [8, 76, 2],
    [10, 74, 2],
    [12, 72, 2],
    [14, 69, 2],
  ],
  9: [
    [0, 70, 3],
    [3, 65, 1],
    [4, 70, 2],
    [6, 74, 2],
    [8, 72, 4],
    [12, 70, 2],
    [14, 69, 2],
  ],
  10: [
    [0, 67, 3],
    [3, 62, 1],
    [4, 67, 2],
    [6, 70, 2],
    [8, 74, 4],
    [12, 72, 2],
    [14, 70, 2],
  ],
  11: [
    [0, 69, 4],
    [4, 73, 2],
    [6, 76, 2],
    [8, 79, 4],
    [12, 76, 2],
    [14, 73, 2],
  ],
  12: [
    [0, 74, 2],
    [2, 74, 1],
    [3, 74, 1],
    [4, 77, 2],
    [6, 74, 2],
    [8, 81, 4],
    [12, 79, 2],
    [14, 77, 2],
  ],
  14: [
    [8, 69, 2],
    [10, 73, 2],
    [12, 76, 2],
    [14, 79, 2],
  ],
  17: [
    [0, 79, 3],
    [3, 76, 1],
    [4, 79, 2],
    [6, 84, 2],
    [8, 83, 2],
    [10, 79, 2],
    [12, 76, 4],
  ],
  18: [
    [0, 76, 3],
    [3, 72, 1],
    [4, 76, 2],
    [6, 81, 2],
    [8, 79, 4],
    [12, 76, 2],
    [14, 74, 2],
  ],
  19: [
    [0, 75, 4],
    [8, 83, 4],
    [12, 81, 2],
  ],
  20: [
    [0, 76, 3],
    [3, 71, 1],
    [4, 76, 2],
    [6, 79, 2],
    [8, 83, 3],
    [11, 79, 1],
    [12, 76, 2],
    [14, 74, 2],
  ],
  21: [
    [8, 80, 2],
    [10, 83, 2],
    [12, 88, 4],
  ],
  22: [
    [0, 84, 2],
    [2, 83, 1],
    [3, 79, 1],
    [4, 76, 4],
    [12, 79, 2],
    [14, 84, 2],
  ],
  23: [
    [0, 81, 3],
    [3, 76, 1],
    [4, 81, 2],
    [6, 84, 2],
    [8, 83, 4],
    [12, 81, 2],
    [14, 79, 2],
  ],
  24: [
    [8, 75, 2],
    [10, 78, 2],
    [12, 81, 2],
    [14, 83, 2],
  ],
};
for (const [bar, notes] of Object.entries(LEAD)) {
  for (const [step, note, length] of notes) {
    place(guitar(note, length * sixteenth * 0.95, 1), at(Number(bar), step / 4), {
      gain: 0.44,
      pan: -0.25,
      send: 0.35,
    });
  }
}
// A brass answer in the bar before the lead comes in.
for (const [step, note, length] of [
  [8, 76, 2],
  [10, 73, 2],
  [12, 69, 2],
  [14, 67, 2],
]) {
  place(brass(note, length * sixteenth * 0.9, 1, 1), at(7, step / 4), {
    gain: 0.16,
    pan: 0.2,
    send: 0.25,
  });
}

// Inventory sound effects.
place(click(0.5), event("hoverItem"), { gain: 0.1, pan: -0.2 });
place(click(1), event("inspect") - 0.012, { gain: 0.16, pan: 0.1 });
place(click(1), event("inspect") + 0.09, { gain: 0.16, pan: 0.1 });
place(chime(88, 1), event("inspect") + 0.14, { gain: 0.14, pan: 0.2, send: 0.5 });
place(poof(1), event("confirmDelete"), { gain: 0.5, send: 0.2 });
timeline.metal.forEach(([bar, beat], i) => {
  place(clink(1480 * 1.12 ** i, 1), at(bar, beat), { gain: 0.26, pan: -0.2 + i * 0.2, send: 0.3 });
});
place(riser(BEAT / 2, 1), event("confirmCraft"), { gain: 0.2, send: 0.3 });
// The hat: a fanfare on E major and a run of bells.
for (const note of [64, 68, 71, 76, 80])
  place(brass(note, 1.4 * BEAT, 1, 1.4), event("reveal"), { gain: 0.1, send: 0.45 });
[88, 92, 95, 100, 104].forEach((note, i) => {
  place(chime(note, 1), event("reveal") + i * 0.06, { gain: 0.12, pan: -0.4 + i * 0.2, send: 0.5 });
});
place(pop(1), event("reveal"), { gain: 0.42, send: 0.15 });
place(whoosh(0.75, 1), event("clickQuality"), { gain: 0.34, send: 0.25 });
place(lift(1), event("grab"), { gain: 0.3 });
place(thunk(1), event("dropItem"), { gain: 0.5 });

// Outro: one big chord, a tremolo guitar and the room.
place(crash(1), event("outro"), { gain: 0.32, pan: -0.2, send: 0.3 });
place(boom(1), event("outro"), { gain: 0.4 });
place(kick(1), event("outro"), { gain: 0.8 });
place(bass(40, 2.4, 1), event("outro"), { gain: 0.42 });
for (const note of [64, 67, 71, 74, 78])
  place(brass(note, 1.6, 1, 1.3), event("outro"), { gain: 0.085, send: 0.45 });
place(guitar(76, 3.2, 1, { tremolo: 8 }), event("outro"), { gain: 0.24, pan: -0.3, send: 0.5 });
place(guitar(83, 3.2, 1, { tremolo: 8 }), event("outro"), { gain: 0.16, pan: 0.3, send: 0.5 });
place(pad([40, 52, 59, 64, 67], at(timeline.bars) - event("outro") - 1.2, 0.5), event("outro"), {
  gain: 0.45,
  send: 0.5,
});
place(guitar(76, 1.2, 1), event("url"), { gain: 0.22, pan: 0.1, send: 0.6 });

// The dot's pops and the cursor's clicks.
for (const [name, level] of timeline.pops)
  place(pop(level), event(name), { gain: 0.42, send: 0.15 });
for (const name of timeline.clicks) place(click(1), event(name) - 0.012, { gain: 0.16, pan: 0.1 });
const typedLines = Math.round((event("typed") - event("typing")) / sixteenth);
for (let step = 0; step < typedLines; step += 1) {
  place(click(0.6 + random() * 0.3), event("typing") + step * sixteenth, { gain: 0.08, pan: 0.2 });
}

// ---------------------------------------------------------------- reverb

/** Freeverb: eight damped combs and four allpasses per side. */
function freeverb(input, spread) {
  const scale = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((size) => ({
    line: new Float32Array(Math.round((size + spread) * scale)),
    index: 0,
    store: 0,
  }));
  const allpasses = [556, 441, 341, 225].map((size) => ({
    line: new Float32Array(Math.round((size + spread) * scale)),
    index: 0,
  }));
  const feedback = 0.84;
  const damp = 0.32;
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const x = input[i] * 0.015;
    let sum = 0;
    for (const comb of combs) {
      const y = comb.line[comb.index];
      comb.store = y * (1 - damp) + comb.store * damp;
      comb.line[comb.index] = x + comb.store * feedback;
      comb.index = (comb.index + 1) % comb.line.length;
      sum += y;
    }
    for (const allpass of allpasses) {
      const buffered = allpass.line[allpass.index];
      allpass.line[allpass.index] = sum + buffered * 0.5;
      allpass.index = (allpass.index + 1) % allpass.line.length;
      sum = buffered - sum;
    }
    out[i] = sum;
  }
  return out;
}

const wetL = freeverb(verb.l, 0);
const wetR = freeverb(verb.r, 23);

// ---------------------------------------------------------------- master

const left = new Float32Array(LENGTH);
const right = new Float32Array(LENGTH);
const hpL = svf();
const hpR = svf();
let peak = 0;
const fadeStart = at(timeline.bars - 1, 3) * SR;
const fadeEnd = at(timeline.bars) * SR + TAIL * SR * 0.9;
for (let i = 0; i < LENGTH; i += 1) {
  const fade = i < fadeStart ? 1 : Math.max(0, 1 - (i - fadeStart) / (fadeEnd - fadeStart));
  left[i] = Math.tanh(hpL(dry.l[i] + wetL[i] * 2.6, 28).high * 1.15) * fade;
  right[i] = Math.tanh(hpR(dry.r[i] + wetR[i] * 2.6, 28).high * 1.15) * fade;
  peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
}
const norm = 0.89 / peak;

const data = Buffer.alloc(LENGTH * 4);
for (let i = 0; i < LENGTH; i += 1) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i] * norm)) * 32767), i * 4);
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i] * norm)) * 32767), i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);
mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, Buffer.concat([header, data]));
console.log(
  `Wrote ${path.relative(process.cwd(), outFile)} (${(LENGTH / SR).toFixed(1)} s, peak ${peak.toFixed(2)} before normalizing)`,
);
