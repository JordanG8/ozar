import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

const units = Array.from({ length: 20 }, (_, index) => index === 2 ? 101 : 100);
const expectedCount = units.reduce((sum, count) => sum + count, 0);
const vocabularyPath = new URL("../data/builtin-words.json", import.meta.url);
const hebrewMarks = /[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/gu;

function nonemptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateVocabulary(data) {
  if (!Array.isArray(data) || data.length !== expectedCount) {
    throw new Error(`The built-in deck must contain all ${expectedCount} reviewed entries.`);
  }

  let position = 0;
  return units.flatMap((count, unitIndex) => Array.from({ length: count }, () => {
    const word = data[position++];
    const unit = unitIndex + 1;
    if (word?.unit !== unit || !nonemptyText(word.term) || !nonemptyText(word.definition) ||
        !nonemptyText(word.example) || !Number.isInteger(word.difficulty) ||
        word.difficulty < 1 || word.difficulty > 10) {
      throw new Error(`Invalid built-in entry at position ${position} in unit ${unit}.`);
    }

    const answers = Array.isArray(word.accepted_answers) ? word.accepted_answers : [];
    if (answers.length < 3 || answers.length > 8 ||
        !answers.every((answer) => nonemptyText(answer) &&
          answer.trim().split(/\s+/u).length <= 3 &&
          answer.replace(hebrewMarks, "") === answer)) {
      throw new Error(`Invalid accepted answers at position ${position}.`);
    }
    const acceptedAnswers = answers.map((answer) => answer.trim().normalize("NFC"));
    if (new Set(acceptedAnswers).size !== answers.length) {
      throw new Error(`Duplicate accepted answers at position ${position}.`);
    }

    return {
      position,
      unit,
      term: word.term.trim().normalize("NFC"),
      term_plain: word.term.trim().normalize("NFD").replace(hebrewMarks, "").normalize("NFC"),
      definition: word.definition.trim(),
      example: word.example.trim(),
      difficulty: word.difficulty,
      accepted_answers: acceptedAnswers,
    };
  }));
}

async function seed(words) {
  const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Set the intended database connection before seeding.");
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        INSERT INTO decks (kind, name) VALUES ('builtin', 'אוצר')
        ON CONFLICT (kind) WHERE kind = 'builtin' DO NOTHING
      `);
      const { rows: [deck] } = await client.query(
        "SELECT id FROM decks WHERE kind = 'builtin' FOR UPDATE",
      );
      const { rows: existing } = await client.query(
        "SELECT position, term_plain FROM words WHERE deck_id = $1",
        [deck.id],
      );
      if (existing.some((word) => words[word.position - 1]?.term_plain !== word.term_plain)) {
        throw new Error("The built-in deck contains different terms at existing positions. Review the ordering.");
      }

      const result = await client.query(`
        INSERT INTO words (
          deck_id, term, term_plain, definition, example, accepted_answers, unit, position, difficulty
        )
        SELECT $1, term, term_plain, definition, example, accepted_answers, unit, position, difficulty
        FROM jsonb_to_recordset($2::jsonb) AS entry(
          term text, term_plain text, definition text, example text, accepted_answers text[],
          unit integer, position integer, difficulty smallint
        )
        ON CONFLICT (deck_id, position) DO UPDATE SET
          term = EXCLUDED.term, term_plain = EXCLUDED.term_plain, definition = EXCLUDED.definition,
          example = EXCLUDED.example, accepted_answers = EXCLUDED.accepted_answers,
          unit = EXCLUDED.unit, difficulty = EXCLUDED.difficulty
      `, [deck.id, JSON.stringify(words)]);
      if (result.rowCount !== words.length) throw new Error("Incomplete seed write.");
      await client.query("COMMIT");
      return result.rowCount;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

try {
  const words = validateVocabulary(JSON.parse(await readFile(vocabularyPath, "utf8")));
  if (process.argv.includes("--check")) {
    console.log(`Validated ${words.length} built-in entries.`);
  } else {
    console.log(`Seeded ${await seed(words)} built-in entries.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
