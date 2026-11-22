// Game sounds, rendered sample by sample so they come out the same in every browser and can be
// checked in tests. The palette is one instrument: a plucked nylon-ish string (Karplus-Strong with
// a tuned allpass) plus felt and wood knocks for the buttons. No oscillator beeps.

export type Sound =
  | { name: "press" } | { name: "release" } | { name: "next" } | { name: "wrong" }
  | { name: "correct"; step: number } | { name: "partial"; step: number }
  | { name: "milestone" } | { name: "goal" };

export const soundKey = (sound: Sound) => "step" in sound ? `${sound.name}:${ladderIndex(sound.step)}` : sound.name;

// Correct answers climb D major pentatonic with the combo, from D4 to B5, then stay at the top.
const ladder = [246.94, 293.66, 329.63, 369.99, 440, 493.88, 587.33, 659.26, 739.99, 880, 987.77];
const ladderIndex = (step: number) => Math.min(ladder.length - 1, Math.max(1, Math.round(step)));
const note = (semitones: number) => 293.66 * 2 ** (semitones / 12);

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (((value ^ (value >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

type Pluck = { tau: number; seconds: number; bright?: number; grit?: number; pick?: number; seed?: number };

/**
 * One plucked string. tau is how long the fundamental takes to fall to 1/e. The string starts in the
 * triangle a fingertip pulls it into at pick (warm, 12 dB per octave), roughened by grit of noise
 * whose colour is bright, for the contact of skin or nail.
 */
function pluck(rate: number, frequency: number, { tau, seconds, bright = .3, grit = .3, pick = .2, seed = 7 }: Pluck) {
  const period = rate / frequency;
  const size = Math.max(2, Math.floor(period - .6));
  const fraction = period - .5 - size;
  const allpass = (1 - fraction) / (1 + fraction);
  const loss = Math.exp(-1 / (frequency * tau));
  const line = new Float32Array(size);
  const noise = random(seed);
  let smooth = 0;
  for (let i = 0; i < size; i++) {
    const x = i / size;
    smooth += (noise() - smooth) * bright;
    line[i] = (x < pick ? x / pick : (1 - x) / (1 - pick)) * (1 - grit) + smooth * grit * 2.5;
  }
  const shaped = line;
  let mean = 0;
  for (const value of shaped) mean += value / size;
  let peak = 0;
  for (let i = 0; i < size; i++) peak = Math.max(peak, Math.abs(shaped[i] -= mean));
  for (let i = 0; i < size; i++) shaped[i] /= peak || 1;

  const out = new Float32Array(Math.floor(rate * seconds));
  let index = 0, last = 0, inputDelay = 0, outputDelay = 0;
  for (let n = 0; n < out.length; n++) {
    const sample = shaped[index];
    out[n] = sample;
    const averaged = loss * .5 * (sample + last);
    last = sample;
    const tuned = allpass * averaged + inputDelay - allpass * outputDelay;
    inputDelay = averaged;
    outputDelay = tuned;
    shaped[index] = tuned;
    index = (index + 1) % size;
  }
  return out;
}

/** A struck resonance: a decaying partial whose pitch falls from glide above its rest pitch. */
function mode(out: Float32Array, rate: number, at: number, frequency: number, tau: number, gain: number, glide = 0) {
  let phase = 0;
  for (let n = Math.floor(at * rate); n < out.length; n++) {
    const t = n / rate - at;
    const envelope = Math.exp(-t / tau);
    if (envelope < 1e-4) break;
    phase += 2 * Math.PI * frequency * (1 + glide * Math.exp(-t / .012)) / rate;
    out[n] += gain * envelope * (1 - Math.exp(-t / .0006)) * Math.sin(phase);
  }
}

/** A filtered noise transient: the contact of felt, finger or fret. */
function burst(out: Float32Array, rate: number, at: number, tau: number, gain: number,
  { low = 20_000, high = 0, seed = 3 }: { low?: number; high?: number; seed?: number } = {}) {
  const noise = random(seed);
  const lowCoefficient = 1 - Math.exp(-2 * Math.PI * low / rate);
  const highCoefficient = 1 - Math.exp(-2 * Math.PI * high / rate);
  let lowState = 0, highState = 0;
  for (let n = Math.floor(at * rate); n < out.length; n++) {
    const t = n / rate - at;
    const envelope = Math.exp(-t / tau);
    if (envelope < 1e-4) break;
    lowState += (noise() - lowState) * lowCoefficient;
    highState += (lowState - highState) * highCoefficient;
    out[n] += gain * envelope * (1 - Math.exp(-t / .0004)) * (lowState - highState);
  }
}

/** RBJ peaking filter: the wooden body that makes a string sound like an instrument. */
function body(signal: Float32Array, rate: number, frequency: number, decibels: number, q: number) {
  const amplitude = 10 ** (decibels / 40);
  const omega = 2 * Math.PI * frequency / rate;
  const alpha = Math.sin(omega) / (2 * q);
  const a0 = 1 + alpha / amplitude;
  const b0 = (1 + alpha * amplitude) / a0, b1 = -2 * Math.cos(omega) / a0, b2 = (1 - alpha * amplitude) / a0;
  const a1 = b1, a2 = (1 - alpha / amplitude) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let n = 0; n < signal.length; n++) {
    const x = signal[n];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    signal[n] = y;
  }
  return signal;
}

/** Plays signal back at a changing speed: a string bent into tune, or one going slack. */
function bend(signal: Float32Array, rate: number, speed: (t: number) => number) {
  const out = new Float32Array(signal.length);
  let position = 0;
  for (let n = 0; n < out.length; n++) {
    const index = Math.floor(position);
    if (index + 1 >= signal.length) break;
    const fraction = position - index;
    out[n] = signal[index] * (1 - fraction) + signal[index + 1] * fraction;
    position += speed(n / rate);
  }
  return out;
}

function add(out: Float32Array, signal: Float32Array, rate: number, at: number, gain: number, fadeAt = Infinity, fadeFor = .012) {
  const start = Math.floor(at * rate);
  for (let i = 0; i < signal.length && start + i < out.length; i++) {
    const t = i / rate;
    const fade = t < fadeAt ? 1 : Math.max(0, 1 - (t - fadeAt) / fadeFor);
    if (fade === 0) break;
    out[start + i] += signal[i] * gain * fade;
  }
}

function strum(out: Float32Array, rate: number, at: number, frequencies: number[], spacing: number, string: Omit<Pluck, "seed">, gain: number) {
  frequencies.forEach((frequency, index) => {
    const tone = pluck(rate, frequency, { ...string, seed: 11 + index * 17, pick: .12 + (index % 3) * .05 });
    add(out, tone, rate, at + index * spacing, gain * (1 - index * .05));
  });
}

/** Gentle saturation, a click-free edge at both ends and a fixed peak, so sounds sit at known levels. */
function finish(signal: Float32Array, rate: number, peak: number, drive = 1) {
  let max = 0;
  for (let n = 0; n < signal.length; n++) {
    const value = drive === 1 ? signal[n] : Math.tanh(signal[n] * drive);
    signal[n] = value;
    max = Math.max(max, Math.abs(value));
  }
  const scale = max ? peak / max : 0;
  const edge = Math.floor(rate * .0015), tail = Math.floor(rate * .03);
  for (let n = 0; n < signal.length; n++) {
    const fadeIn = Math.min(1, n / edge);
    const fadeOut = Math.min(1, (signal.length - 1 - n) / tail);
    signal[n] *= scale * fadeIn * fadeOut;
  }
  return signal;
}

const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

export function renderSound(sound: Sound, rate: number): Float32Array {
  switch (sound.name) {
    case "press": {
      // A felt key going down: a soft low thump with a falling pitch and a dull contact.
      const out = new Float32Array(Math.floor(rate * .14));
      // Phone speakers drop most of the 200 Hz body, so the 560 Hz knock carries it there.
      mode(out, rate, 0, 200, .038, .9, .3);
      mode(out, rate, 0, 560, .02, .75, .12);
      mode(out, rate, 0, 1400, .005, .2);
      burst(out, rate, 0, .0014, .5, { low: 3000, seed: 5 });
      return finish(out, rate, .34);
    }
    case "release": {
      // The key coming back up: smaller, higher and drier than the press.
      const out = new Float32Array(Math.floor(rate * .09));
      mode(out, rate, 0, 690, .011, .6);
      mode(out, rate, 0, 1870, .0045, .28);
      burst(out, rate, 0, .0008, .4, { low: 6500, high: 900, seed: 9 });
      return finish(out, rate, .2);
    }
    case "next": {
      // A palm-muted upstroke across four strings: the "chk" of turning the card.
      const out = new Float32Array(Math.floor(rate * .2));
      [note(17), note(12), note(9), note(5)].forEach((frequency, index) => {
        const tone = pluck(rate, frequency, { tau: .03, seconds: .16, bright: .5, grit: .45, pick: .15, seed: 40 + index });
        add(out, tone, rate, index * .0065, .5 - index * .06);
      });
      burst(out, rate, 0, .008, .1, { low: 5000, high: 1500, seed: 13 });
      return finish(body(out, rate, 900, 3, 1.4), rate, .27);
    }
    case "wrong": {
      // A dead low string that goes slightly slack, over a hollow knock. Honest, not a buzzer.
      const out = new Float32Array(Math.floor(rate * .5));
      const thud = pluck(rate, 110, { tau: .085, seconds: .45, bright: .2, grit: .25, pick: .09, seed: 21 });
      add(out, bend(thud, rate, (t) => 2 ** (-.7 * easeOut(t / .22) / 12)), rate, 0, 1);
      mode(out, rate, 0, 72, .07, .55, .35);
      burst(out, rate, .002, .005, .14, { low: 2200, high: 900, seed: 17 });
      return finish(body(out, rate, 210, 4, 1), rate, .36);
    }
    case "correct": {
      // A hammer-on: a grace note one step below, then the target note rings with a soft octave harmonic.
      const step = ladderIndex(sound.step);
      const target = ladder[step];
      const out = new Float32Array(Math.floor(rate * 1.1));
      const grace = pluck(rate, ladder[step - 1], { tau: .3, seconds: .1, bright: .4, grit: .35, pick: .12, seed: 31 });
      add(out, grace, rate, 0, .7, .04, .014);
      const ring = pluck(rate, target, { tau: .5, seconds: 1.05, bright: .35, grit: .28, pick: .14, seed: 32 });
      add(out, ring, rate, .046, .95);
      mode(out, rate, .046, target * 2, .28, .055);
      return finish(body(out, rate, 240, 4, 1.1), rate, .5);
    }
    case "partial": {
      // Close enough: the same string, plucked flat and bent up into tune.
      const target = ladder[ladderIndex(sound.step)];
      const out = new Float32Array(Math.floor(rate * 1));
      const ring = pluck(rate, target, { tau: .45, seconds: 1.1, bright: .35, grit: .28, pick: .14, seed: 33 });
      add(out, bend(ring, rate, (t) => 2 ** (-1.6 * (1 - easeOut(t / .16)) / 12)), rate, 0, 1);
      return finish(body(out, rate, 240, 4, 1.1), rate, .44);
    }
    case "milestone": {
      // A fast upstroke of an open Dsus2 voicing, then a natural harmonic floating above it.
      const out = new Float32Array(Math.floor(rate * 2.4));
      strum(out, rate, 0, [note(-12), note(-5), note(0), note(2), note(7), note(12)], .016,
        { tau: 1.1, seconds: 2.3, bright: .35, grit: .3 }, .5);
      mode(out, rate, .13, note(24), .7, .1);
      mode(out, rate, .13, note(36), .25, .02);
      return finish(body(out, rate, 230, 3, 1), rate, .58, 1.3);
    }
    case "goal": {
      // A slow, resolved Dadd9 strum with two harmonics answering each other.
      const out = new Float32Array(Math.floor(rate * 3.2));
      strum(out, rate, 0, [note(-12), note(-5), note(0), note(4), note(7), note(14)], .048,
        { tau: 1.4, seconds: 3, bright: .3, grit: .25 }, .5);
      mode(out, rate, .34, note(19), .8, .09);
      mode(out, rate, .52, note(24), 1, .09);
      return finish(body(out, rate, 230, 3, 1), rate, .6, 1.3);
    }
  }
}
