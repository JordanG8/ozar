import { fsrs, Rating, State, type Card } from "ts-fsrs";
import type { cards, userSettings } from "@/lib/db/schema";

const states = { new: State.New, learning: State.Learning, review: State.Review, relearning: State.Relearning };
const grades = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy } as const;

export function scheduleLearning(
  stored: typeof cards.$inferSelect,
  settings: typeof userSettings.$inferSelect,
  rating: keyof typeof grades,
  now: Date,
  queueStage: "voice_meaning" | "reverse_choice" | null,
) {
  const graduating = queueStage === null;
  const optimization = settings.fsrsParams;
  const scheduler = fsrs({
    request_retention: settings.desiredRetention,
    enable_short_term: !graduating,
    ...(optimization?.version === "FSRS-6" && optimization.weights.length === 21
      ? { w: optimization.weights } : {}),
  });
  const card: Card = {
    due: stored.due,
    stability: stored.stability,
    difficulty: stored.difficulty,
    elapsed_days: stored.elapsedDays,
    scheduled_days: stored.scheduledDays,
    reps: stored.reps,
    lapses: stored.lapses,
    learning_steps: stored.learningStep,
    state: stored.reps === 0 ? State.New : states[stored.state],
    last_review: stored.lastReviewAt ?? undefined,
  };
  const { card: next, log } = scheduler.next(card, now, grades[rating]);
  return {
    reviewElapsedDays: log.elapsed_days,
    updates: {
      state: graduating ? "review" as const : "learning" as const,
      due: graduating ? next.due : new Date(Math.max(now.getTime() + 60_000, Math.min(next.due.getTime(), now.getTime() + 600_000))),
      lastReviewAt: now,
      stability: next.stability,
      difficulty: next.difficulty,
      elapsedDays: next.elapsed_days,
      scheduledDays: graduating ? next.scheduled_days : 0,
      reps: next.reps,
      lapses: next.lapses,
      learningStep: queueStage === "reverse_choice" ? 1 : 0,
    },
  };
}
