import { and, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { cards, decks, learningQueue, learningRuns, reviewLogs, userSettings, words } from "./db/schema";
import { dayStreak } from "./learn/infinite";
import { getDb } from "./learn/store";
import { defaultPreferences } from "./settings";

export type WeekDay = { label: string; state: "met" | "today" | "missed" | "future" };
export type HomeSummary = {
  streak: number;
  today: number;
  goal: number;
  week: WeekDay[];
  seen: number;
  learnWaiting: number;
  learnInProgress: boolean;
};

const weekLabels = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];

export function weekOf(today: string, answered: Map<string, number>, goal: number): WeekDay[] {
  const current = new Date(`${today}T00:00:00Z`);
  const sunday = new Date(current);
  sunday.setUTCDate(current.getUTCDate() - current.getUTCDay());
  return weekLabels.map((label, index) => {
    const day = new Date(sunday);
    day.setUTCDate(sunday.getUTCDate() + index);
    const key = day.toISOString().slice(0, 10);
    const met = (answered.get(key) ?? 0) >= goal;
    const state = met ? "met" : key === today ? "today" : key > today ? "future" : "missed";
    return { label, state };
  });
}

// Read-only snapshot for Home: it never creates a learner or reserves a learning batch.
export async function getHomeSummary(userId: string): Promise<HomeSummary> {
  const db = getDb();
  const [settings] = await db.select({
    goal: userSettings.dailyGoal, newPerDay: userSettings.newPerDay, timeZone: userSettings.timeZone,
  }).from(userSettings).where(eq(userSettings.userId, userId));
  const goal = settings?.goal ?? defaultPreferences.dailyGoal;
  const newPerDay = settings?.newPerDay ?? defaultPreferences.newPerDay;
  const timeZone = settings?.timeZone ?? "Asia/Jerusalem";
  const localToday = sql<string>`(now() AT TIME ZONE ${timeZone})::date`;

  const snapshot = await db.transaction(async (tx) => {
    const { rows: [{ today }] } = await tx.execute<{ today: string }>(sql`select ${localToday}::text as today`);
    const daily = await tx.select({ day: reviewLogs.reviewDay, answers: count() }).from(reviewLogs)
      .where(eq(reviewLogs.userId, userId)).groupBy(reviewLogs.reviewDay);
    const [{ seen }] = await tx.select({ seen: count() }).from(cards)
      .where(and(eq(cards.userId, userId), isNotNull(cards.firstSeenAt)));
    const [{ queued }] = await tx.select({ queued: count() }).from(learningQueue)
      .innerJoin(learningRuns, eq(learningRuns.id, learningQueue.runId))
      .where(and(eq(learningQueue.userId, userId), isNull(learningRuns.finishedAt)));
    const [{ introduced }] = await tx.select({ introduced: count() }).from(cards).where(and(
      eq(cards.userId, userId), sql`(${cards.firstSeenAt} AT TIME ZONE ${timeZone})::date = ${localToday}`,
    ));
    const [{ unseen }] = await tx.select({ unseen: count() }).from(words).innerJoin(decks, eq(decks.id, words.deckId))
      .leftJoin(cards, and(eq(cards.wordId, words.id), eq(cards.userId, userId)))
      .where(and(eq(decks.kind, "builtin"), isNull(cards.id)));
    return { today, daily, seen, queued, introduced, unseen };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  const { today, daily, seen, queued, introduced, unseen } = snapshot;

  const answered = new Map(daily.map(({ day, answers }) => [day, answers]));
  return {
    streak: dayStreak(today, [...answered.keys()]),
    today: answered.get(today) ?? 0,
    goal,
    week: weekOf(today, answered, goal),
    seen,
    learnInProgress: queued > 0,
    learnWaiting: queued > 0 ? queued : Math.min(Math.max(0, newPerDay - introduced), unseen),
  };
}
