import { fsrs, Rating, State, type Card } from "ts-fsrs";
import type { cards, userSettings } from "@/lib/db/schema";

const states = { new: State.New, learning: State.Learning, review: State.Review, relearning: State.Relearning };
const grades = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy } as const;

function schedulerFor(settings: typeof userSettings.$inferSelect, shortTerm = true) {
  const optimization = settings.fsrsParams;
  return fsrs({
    request_retention: settings.desiredRetention,
    enable_short_term: shortTerm,
    ...(optimization?.version === "FSRS-6" && optimization.weights.length === 21
      ? { w: optimization.weights } : {}),
  });
}

function fsrsCard(stored: typeof cards.$inferSelect): Card {
  return {
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
}

export function recallEstimator(settings: typeof userSettings.$inferSelect, now: Date) {
  const scheduler = schedulerFor(settings);
  return (card: typeof cards.$inferSelect) => scheduler.get_retrievability(fsrsCard(card), now, false);
}

export function scheduleReview(
  stored: typeof cards.$inferSelect,
  settings: typeof userSettings.$inferSelect,
  rating: keyof typeof grades,
  now: Date,
  shortTerm = true,
) {
  const scheduler = schedulerFor(settings, shortTerm);
  const { card: next, log } = scheduler.next(fsrsCard(stored), now, grades[rating]);
  const state = (["new", "learning", "review", "relearning"] as const)[next.state];
  return {
    reviewElapsedDays: log.elapsed_days,
    updates: {
      state,
      due: next.due,
      lastReviewAt: now,
      stability: next.stability,
      difficulty: next.difficulty,
      elapsedDays: next.elapsed_days,
      scheduledDays: next.scheduled_days,
      reps: next.reps,
      lapses: next.lapses,
      learningStep: next.learning_steps,
    },
  };
}

export function scheduleLearning(
  stored: typeof cards.$inferSelect,
  settings: typeof userSettings.$inferSelect,
  rating: keyof typeof grades,
  now: Date,
  queueStage: "voice_meaning" | "reverse_choice" | null,
) {
  const scheduled = scheduleReview(stored, settings, rating, now, queueStage !== null);
  if (queueStage === null) return scheduled;
  return {
    ...scheduled,
    updates: {
      ...scheduled.updates,
      state: "learning" as const,
      due: new Date(Math.max(+now + 60_000, Math.min(+scheduled.updates.due, +now + 600_000))),
      scheduledDays: 0,
      learningStep: queueStage === "reverse_choice" ? 1 : 0,
    },
  };
}
