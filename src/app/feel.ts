"use client";

import { renderSound, soundKey, type Sound } from "@/lib/sound/synth";

// Sound and touch feedback for game moments. Both are per-device preferences, so they live in
// localStorage rather than the account settings.

export type FeelSetting = "sound" | "haptics";
export type Moment =
  | "press" | "release" | "next" | "wrong" | "correct" | "partial" | "milestone" | "goal"
  | "nudge" | "tick" | "error";

const storageKeys: Record<FeelSetting, string> = { sound: "ozar:sound", haptics: "ozar:haptics" };

// Android vibration patterns in ms (on, off, on, …). Kept short: felt, not heard.
const patterns: Record<Moment, number | number[]> = {
  press: 10,
  release: 6,
  next: 8,
  correct: 16,
  partial: [10, 55, 16],
  wrong: [26, 70, 26],
  milestone: [14, 45, 14, 45, 42],
  goal: [20, 70, 20, 70, 90],
  nudge: [6, 274, 6],
  tick: 6,
  error: [12, 70, 12],
};

// Moments without a sound are touch only.
const sounds: Partial<Record<Moment, Sound["name"]>> = {
  press: "press", release: "release", next: "next", wrong: "wrong",
  correct: "correct", partial: "partial", milestone: "milestone", goal: "goal",
};

// Small random detune and level on the button sounds so repeats do not sound stamped out.
const humanize: Partial<Record<Moment, number>> = { press: 18, release: 25, next: 30 };

export function feelEnabled(setting: FeelSetting) {
  try { return localStorage.getItem(storageKeys[setting]) !== "off"; } catch { return true; }
}

export function setFeelEnabled(setting: FeelSetting, enabled: boolean) {
  try { localStorage.setItem(storageKeys[setting], enabled ? "on" : "off"); } catch { /* Private mode keeps the default. */ }
}

let context: AudioContext | null = null;
let output: GainNode | null = null;
const buffers = new Map<string, AudioBuffer>();

function audio() {
  if (context || typeof window === "undefined") return context;
  const Context = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  try {
    context = new Context({ latencyHint: "interactive" });
    output = context.createGain();
    output.gain.value = .9;
    output.connect(context.destination);
  } catch {
    context = null;
  }
  return context;
}

function buffer(sound: Sound, audioContext: AudioContext) {
  const key = soundKey(sound);
  let rendered = buffers.get(key);
  if (!rendered) {
    const samples = renderSound(sound, audioContext.sampleRate);
    rendered = audioContext.createBuffer(1, samples.length, audioContext.sampleRate);
    rendered.getChannelData(0).set(samples);
    buffers.set(key, rendered);
  }
  return rendered;
}

function start(sound: Sound, audioContext: AudioContext, spread = 0) {
  const source = audioContext.createBufferSource();
  source.buffer = buffer(sound, audioContext);
  const level = audioContext.createGain();
  if (spread) {
    source.playbackRate.value = 2 ** ((Math.random() * 2 - 1) * spread / 1200);
    level.gain.value = 10 ** ((Math.random() * 2 - 1) * 1.5 / 20);
  }
  source.connect(level).connect(output!);
  source.start();
}

function play(sound: Sound, spread?: number) {
  if (!feelEnabled("sound")) return;
  const audioContext = audio();
  if (!audioContext) return;
  if (audioContext.state === "running") { start(sound, audioContext, spread); return; }
  // The first gesture unlocks audio. Play once it is running, unless that takes long enough to feel late.
  const asked = performance.now();
  void audioContext.resume().then(() => {
    if (performance.now() - asked < 180) start(sound, audioContext, spread);
  }).catch(() => {});
}

// iOS Safari has no Vibration API, but toggling a native switch inside a gesture gives a light tap.
function iosTap() {
  try {
    const label = document.createElement("label");
    label.ariaHidden = "true";
    label.style.display = "none";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    label.append(input);
    document.head.append(label);
    label.click();
    label.remove();
  } catch {
    // No haptics on this device.
  }
}

const canVibrate = () => typeof navigator.vibrate === "function";
const appleTouch = () => !canVibrate() &&
  (/iP(hone|ad|od)/u.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/u.test(navigator.userAgent)));

function buzz(moment: Moment, { gesture = false } = {}) {
  if (!feelEnabled("haptics")) return;
  if (canVibrate()) {
    try { navigator.vibrate(patterns[moment]); } catch { /* Blocked until the first tap. */ }
  } else if (gesture && appleTouch()) {
    iosTap();
  }
}

/**
 * Plays a moment's sound and vibration. step is the combo for correct and partial answers, which
 * climbs the sound up a scale. Pass gesture when called straight from a tap, so iOS can answer it.
 */
export function feel(moment: Moment, { step = 1, gesture = false }: { step?: number; gesture?: boolean } = {}) {
  if (typeof window === "undefined") return;
  buzz(moment, { gesture });
  const name = sounds[moment];
  if (!name) return;
  play(name === "correct" || name === "partial" ? { name, step } : { name } as Sound, humanize[moment]);
}

/** Creates and resumes audio inside the first gesture, then renders the common sounds while idle. */
function unlock() {
  if (!feelEnabled("sound")) return;
  const audioContext = audio();
  if (!audioContext) return;
  if (audioContext.state !== "running") void audioContext.resume().catch(() => {});
  if (buffers.size) return;
  const warm = () => {
    for (const sound of [{ name: "press" }, { name: "release" }, { name: "next" }, { name: "wrong" },
      { name: "correct", step: 1 }, { name: "correct", step: 2 }] as Sound[]) buffer(sound, audioContext);
  };
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(warm, { timeout: 1500 });
  else window.setTimeout(warm, 200);
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", unlock, { capture: true, passive: true });
  window.addEventListener("keydown", unlock, { capture: true, passive: true });
}
