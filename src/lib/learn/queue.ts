export type LearningStage = "intro" | "voice_meaning" | "reverse_choice";

export function nextStage(kind: LearningStage, correct: boolean, ordinal: number, random = Math.random) {
  if (kind === "reverse_choice" && correct) return null;
  const reverse = kind === "voice_meaning" && correct;
  const gap = reverse ? 15 + Math.floor(random() * 6) : 7 + Math.floor(random() * 4);
  return { nextStage: (reverse ? "reverse_choice" : "voice_meaning") as LearningStage, eligiblePosition: ordinal + gap + 1 };
}

export function selectQueued<T extends { nextStage: LearningStage; eligiblePosition: number; position: number }>(
  queue: T[], ordinal: number,
) {
  const ready = queue.filter((item) => item.nextStage !== "intro" && item.eligiblePosition <= ordinal);
  const introductions = queue.filter((item) => item.nextStage === "intro");
  const candidates = ready.length ? ready : introductions.length ? introductions : queue;
  return candidates.toSorted((left, right) => left.eligiblePosition - right.eligiblePosition ||
    left.position - right.position)[0];
}

export function rateAnswer(correct: boolean, hintLevel: number, responseMs: number, times: number[]) {
  if (!correct) return "again";
  if (hintLevel) return "hard";
  if (times.length < 5) return "good";
  const sorted = times.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  if (responseMs <= median * 0.75) return "easy";
  if (responseMs >= median * 1.35) return "hard";
  return "good";
}
