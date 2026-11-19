import { and, asc, count, eq, isNotNull, or } from "drizzle-orm";
import { cards, decks, words } from "../db/schema";
import { normalize } from "../learn/matcher";
import { getDb, StudyConflict, withLearner } from "../learn/store";
import { acceptedFromDefinition, type ImportWord } from "./rows";

export async function listDecks(userId: string) {
  return getDb().select({ id: decks.id, name: decks.name, kind: decks.kind, size: count(words.id), seen: count(cards.id) })
    .from(decks).leftJoin(words, eq(words.deckId, decks.id))
    .leftJoin(cards, and(eq(cards.wordId, words.id), eq(cards.userId, userId), isNotNull(cards.firstSeenAt)))
    .where(or(eq(decks.kind, "builtin"), eq(decks.ownerId, userId)))
    .groupBy(decks.id).orderBy(asc(decks.kind), asc(decks.createdAt));
}

export function saveDeck(userId: string, id: string, name: string, entries: ImportWord[]) {
  return withLearner(userId, async (tx) => {
    const [inserted] = await tx.insert(decks).values({ id, ownerId: userId, name, kind: "imported" })
      .onConflictDoNothing().returning({ id: decks.id });
    if (!inserted) {
      const [existing] = await tx.select({ id: decks.id }).from(decks)
        .where(and(eq(decks.id, id), eq(decks.ownerId, userId), eq(decks.kind, "imported")));
      if (!existing) throw new StudyConflict();
      return existing;
    }
    await tx.insert(words).values(entries.map((word, index) => ({
      ...word, deckId: id, termPlain: normalize(word.term), position: index + 1,
      acceptedAnswers: acceptedFromDefinition(word.definition),
    })));
    return inserted;
  });
}
