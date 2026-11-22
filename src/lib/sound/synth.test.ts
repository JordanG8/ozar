import { describe, expect, it } from "vitest";
import { renderSound, soundKey, type Sound } from "./synth";

const sounds: Sound[] = [
  { name: "press" }, { name: "release" }, { name: "next" }, { name: "wrong" },
  { name: "correct", step: 1 }, { name: "correct", step: 40 }, { name: "partial", step: 3 },
  { name: "milestone" }, { name: "goal" },
];

// Strongest period between 1 and 20 ms, by autocorrelation over a window after the attack.
function pitch(signal: Float32Array, rate: number, from: number) {
  const start = Math.floor(from * rate), size = Math.floor(rate * .08);
  let best = 0, bestLag = 0;
  for (let lag = Math.floor(rate / 1000); lag < rate / 50; lag++) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += signal[start + i] * signal[start + i + lag];
    if (sum > best) { best = sum; bestLag = lag; }
  }
  return rate / bestLag;
}

describe("game sounds", () => {
  for (const rate of [44_100, 48_000]) {
    it.each(sounds.map((sound) => [soundKey(sound), sound] as const))(`renders %s cleanly at ${rate} Hz`, (_, sound) => {
      const samples = renderSound(sound, rate);
      expect(samples.length).toBeGreaterThan(rate * .05);
      let peak = 0;
      for (const value of samples) {
        expect(Number.isFinite(value)).toBe(true);
        peak = Math.max(peak, Math.abs(value));
      }
      expect(peak).toBeGreaterThan(.15);
      expect(peak).toBeLessThanOrEqual(.6 + 1e-6);
      expect(Math.abs(samples[0])).toBeLessThan(.01);
      expect(Math.abs(samples.at(-1)!)).toBeLessThan(.001);
    });
  }

  it("tunes the string to the combo ladder", () => {
    // Combo 4 lands on A4 and combo 1 on D4, within a few cents.
    for (const [step, frequency] of [[4, 440], [1, 293.66]]) {
      const heard = pitch(renderSound({ name: "correct", step }, 48_000), 48_000, .25);
      expect(Math.abs(1200 * Math.log2(heard / frequency))).toBeLessThan(15);
    }
  });

  it("caps the climb so long combos share one cached sound", () => {
    expect(soundKey({ name: "correct", step: 12 })).toBe(soundKey({ name: "correct", step: 90 }));
    expect(soundKey({ name: "correct", step: 2 })).not.toBe(soundKey({ name: "correct", step: 3 }));
  });
});
