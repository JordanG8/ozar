export function infiniteKind(answers: number) {
  return answers % 4 === 3 ? "reverse_choice" : "voice_meaning";
}

export function pickInfinite<T extends { id: string; weight: number }>(
  candidates: T[],
  recent: string[],
  random = Math.random,
): T | undefined {
  // With fewer than six seen words, relax the oldest exclusions first so practice can continue.
  const excluded = new Set(recent.slice(0, Math.min(5, Math.max(0, candidates.length - 1))));
  const available = candidates.filter(({ id }) => !excluded.has(id));
  let sample = random() * available.reduce((sum, card) => sum + card.weight, 0);
  for (const card of available) {
    sample -= card.weight;
    if (sample < 0) return card;
  }
  return available.at(-1);
}

export function dayStreak(today: string, answered: string[]) {
  const days = new Set(answered);
  const cursor = new Date(today);
  if (!days.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}
