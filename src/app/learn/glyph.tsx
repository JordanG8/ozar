"use client";

import { useEffect, useRef } from "react";

// The mic glyph and the "next" double chevron are drawn from the same three strokes, so one can
// turn into the other: the capsule opens like a beak into the back chevron, the cradle folds into
// the front one and the stem melts into the front tip. On the way the glyph turns a quarter turn
// clockwise (mic upright → arrows pointing left, the reading direction of Hebrew) with a small
// overshoot, and dips in scale at the midpoint so the change reads as one gesture.

type Point = readonly [number, number];
type Shape = Point[];

const k = .5523;
const center = 12;
const third = (a: Point, b: Point): Point[] => [
  [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3],
  [a[0] + (b[0] - a[0]) * 2 / 3, a[1] + (b[1] - a[1]) * 2 / 3],
  b,
];
const along = (points: Point[]): Shape => points.slice(1).reduce<Shape>((shape, point, index) =>
  [...shape, ...third(points[index], point)], [points[0]]);

// Mic, from the icon set: a 6×11 capsule, a cradle of radius 6.5 and a stem.
const capsule: Shape = [
  [12, 3], [12 + 3 * k, 3], [15, 6 - 3 * k], [15, 6],
  ...third([15, 6], [15, 11]),
  [15, 11 + 3 * k], [12 + 3 * k, 14], [12, 14],
  [12 - 3 * k, 14], [9, 11 + 3 * k], [9, 11],
  ...third([9, 11], [9, 6]),
  [9, 6 - 3 * k], [12 - 3 * k, 3], [12, 3],
];
const cradle: Shape = [[5.5, 11], [5.5, 11 + 6.5 * k], [12 - 6.5 * k, 17.5], [12, 17.5],
  [12 + 6.5 * k, 17.5], [18.5, 11 + 6.5 * k], [18.5, 11]];
const stem: Shape = along([[12, 17.5], [12, 21]]);

// Arrows: two 45° chevrons 6 apart, as tall as the mic's capsule and cradle together, centred on the grid.
const front: Shape = along([[12.25, 5.5], [5.75, 12], [12.25, 18.5]]);
const back: Shape = along([[18.25, 18.5], [16.08, 16.33], [13.92, 14.17], [11.75, 12], [13.92, 9.83], [16.08, 7.67], [18.25, 5.5]]);
const tip: Shape = stem.map(() => [5.75, 12] as const);

const strokes = [
  { mic: cradle, arrows: front, delay: 0 },
  { mic: capsule, arrows: back, delay: 50 },
  { mic: stem, arrows: tip, delay: 0 },
] as const;

const duration = 560;
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const easeInOut = (t: number) => t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
const backOut = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
const smooth = (edge: number, t: number) => { const x = clamp(t / edge); return x * x * (3 - 2 * x); };

function frame(from: Shape, to: Shape, progress: number) {
  const shape = easeInOut(progress);
  const angle = -Math.PI / 2 * (1 - backOut(progress));
  const scale = 1 - .12 * Math.sin(Math.PI * shape);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return from.map(([x, y], index) => {
    // The mic turned a quarter clockwise lines up with the arrows; blend there, then turn back.
    const turnedX = center - (y - center), turnedY = center + (x - center);
    const blendX = turnedX + (to[index][0] - turnedX) * shape - center;
    const blendY = turnedY + (to[index][1] - turnedY) * shape - center;
    return [center + scale * (blendX * cos - blendY * sin), center + scale * (blendX * sin + blendY * cos)] as const;
  });
}

function data(points: readonly Point[]) {
  const at = ([x, y]: Point) => `${x.toFixed(2)} ${y.toFixed(2)}`;
  let path = `M${at(points[0])}`;
  for (let i = 1; i < points.length; i += 3) path += `C${at(points[i])} ${at(points[i + 1])} ${at(points[i + 2])}`;
  return path;
}

// Stroke opacities: the stem melts away and the back chevron settles a little dimmer, as a trail.
const opacity = (stroke: number, progress: number) =>
  stroke === 2 ? 1 - smooth(.5, easeInOut(progress)) : stroke === 1 ? 1 - .45 * easeInOut(progress) : 1;

const still = (progress: 0 | 1) => strokes.map((stroke, index) => ({
  d: data(progress ? stroke.arrows : stroke.mic), opacity: opacity(index, progress),
}));
const micStill = still(0), arrowsStill = still(1);
const parts = ["front", "back", "stem"] as const;

export type GlyphShape = "mic" | "arrows";

/**
 * A 24-grid glyph that is the mic or the double chevron and morphs between them when `to` changes.
 * With draw, the arrows draw themselves in instead. onArrive runs once the arrows have settled.
 */
export function Glyph({ to, initial = to, draw, size = 30, className, onArrive }: {
  to: GlyphShape; initial?: GlyphShape; draw?: boolean; size?: number; className?: string; onArrive?: () => void;
}) {
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const progress = useRef(initial === "arrows" ? 1 : 0);
  const arrive = useRef(onArrive);
  useEffect(() => { arrive.current = onArrive; }, [onArrive]);

  useEffect(() => {
    const goal = to === "arrows" ? 1 : 0;
    const paint = (overall: number, elapsed: number, from: number) => strokes.forEach((stroke, index) => {
      const path = paths.current[index];
      if (!path) return;
      const local = elapsed < 0 ? overall : from + (goal - from) * clamp((elapsed - stroke.delay) / (duration - 50));
      path.setAttribute("d", data(frame(stroke.mic, stroke.arrows, local)));
      path.setAttribute("opacity", opacity(index, local).toFixed(3));
    });
    if (progress.current === goal) {
      if (!goal) return;
      const settle = window.setTimeout(() => arrive.current?.(), draw ? 480 : 0);
      return () => window.clearTimeout(settle);
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      paint(goal, -1, goal);
      progress.current = goal;
      if (goal) arrive.current?.();
      return;
    }
    const from = progress.current;
    const started = performance.now();
    let request = requestAnimationFrame(function tick(now) {
      const elapsed = now - started;
      paint(goal, elapsed, from);
      if (elapsed < duration) {
        request = requestAnimationFrame(tick);
        return;
      }
      progress.current = goal;
      if (goal) arrive.current?.();
    });
    return () => {
      cancelAnimationFrame(request);
      progress.current = from + (goal - from) * clamp((performance.now() - started) / duration);
    };
  }, [to, draw]);

  const rest = initial === "arrows" ? arrowsStill : micStill;
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} data-draw={draw || undefined}
      overflow="visible">
      {parts.map((part, index) => <g key={part} data-part={part}>
        <path ref={(element) => { paths.current[index] = element; }} d={rest[index].d} opacity={rest[index].opacity}
          pathLength={draw ? 1 : undefined} />
      </g>)}
    </svg>
  );
}
