import { eq, inArray } from "drizzle-orm";
import {
  appUsers, cards, decks, learningQueue, learningRuns, reviewLogs, sessionPrompts, sessions, userSettings, words,
} from "./db/schema";
import { getDb, lockLearner, withLearner } from "./learn/store";

export const defaultPreferences = {
  newPerDay: 25,
  dailyGoal: 50,
  inputDefault: "voice",
  desiredRetention: 0.9,
} as const;

export type Preferences = Pick<typeof userSettings.$inferSelect, keyof typeof defaultPreferences>;

export async function getPreferences(userId: string): Promise<Preferences> {
  const [settings] = await getDb().select({
    newPerDay: userSettings.newPerDay, dailyGoal: userSettings.dailyGoal, inputDefault: userSettings.inputDefault,
    desiredRetention: userSettings.desiredRetention,
  }).from(userSettings).where(eq(userSettings.userId, userId));
  return settings ?? defaultPreferences;
}

export function validatePreferences(value: unknown): Preferences | null {
  if (!value || typeof value !== "object") return null;
  const { newPerDay, dailyGoal, inputDefault, desiredRetention } = value as Partial<Preferences>;
  if (typeof newPerDay !== "number" || !Number.isInteger(newPerDay) || newPerDay < 0 || newPerDay > 2000 ||
    typeof dailyGoal !== "number" || !Number.isInteger(dailyGoal) || dailyGoal < 1 || dailyGoal > 10000 ||
    typeof desiredRetention !== "number" || !Number.isFinite(desiredRetention) || desiredRetention < .01 || desiredRetention > .99 ||
    (inputDefault !== "voice" && inputDefault !== "typed")) return null;
  return { newPerDay, dailyGoal, inputDefault, desiredRetention };
}

export function savePreferences(userId: string, preferences: Preferences) {
  return withLearner(userId, (tx) => tx.update(userSettings).set(preferences).where(eq(userSettings.userId, userId)));
}

export function exportData(userId: string) {
  return getDb().transaction(async (tx) => {
    const [learner] = await tx.select().from(appUsers).where(eq(appUsers.id, userId));
    const [settings] = await tx.select().from(userSettings).where(eq(userSettings.userId, userId));
    const ownedDecks = await tx.select().from(decks).where(eq(decks.ownerId, userId));
    const ownedWords = ownedDecks.length ? await tx.select().from(words).where(inArray(words.deckId, ownedDecks.map(({ id }) => id))) : [];
    const ownCards = await tx.select({
      card: cards, term: words.term, deckId: words.deckId,
    }).from(cards).innerJoin(words, eq(words.id, cards.wordId)).where(eq(cards.userId, userId));
    return {
      learner: learner ?? null, settings: settings ?? defaultPreferences, decks: ownedDecks, words: ownedWords, cards: ownCards,
      sessions: await tx.select().from(sessions).where(eq(sessions.userId, userId)),
      reviews: await tx.select().from(reviewLogs).where(eq(reviewLogs.userId, userId)),
      prompts: await tx.select().from(sessionPrompts).where(eq(sessionPrompts.userId, userId)),
      learningRuns: await tx.select().from(learningRuns).where(eq(learningRuns.userId, userId)),
      learningQueue: await tx.select().from(learningQueue).where(eq(learningQueue.userId, userId)),
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export function deleteAccount(userId: string, removeIdentity: () => Promise<void>) {
  return getDb().transaction(async (tx) => {
    await lockLearner(tx, userId);
    await tx.delete(appUsers).where(eq(appUsers.id, userId));
    // Hold the learner lock until identity removal succeeds so queued writes cannot recreate app data.
    await removeIdentity();
  });
}
