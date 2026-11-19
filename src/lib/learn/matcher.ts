const hebrewMarks = /[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/gu;
const finalLetters: Record<string, string> = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };
const stopWords = new Set(["של", "את", "או", "על", "אל", "עם", "כל", "לא", "גם", "הוא", "היא", "זה", "זו", "כדי", "אשר", "כמו", "דבר", "אדם"].map(normalize));

export function normalize(value: string) {
  return value.normalize("NFD").replace(hebrewMarks, "").toLowerCase()
    .replace(/[ךםןףץ]/gu, (letter) => finalLetters[letter])
    .replace(/['״׳"]/gu, "")
    .replace(/[^א-תa-z0-9]+/gu, " ").trim();
}

function tokens(value: string) {
  return normalize(value).split(" ").filter(Boolean);
}

function distance(left: string, right: string) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 0; i < left.length; i++) {
    const current = [i + 1];
    for (let j = 0; j < right.length; j++) {
      current.push(Math.min(current[j] + 1, previous[j + 1] + 1, previous[j] + Number(left[i] !== right[j])));
    }
    previous = current;
  }
  return previous[right.length];
}

function forms(word: string) {
  if (!/^[א-ת]{4,}$/u.test(word)) return [word];
  const prefix = /^[הבלומשכ](?=.{3})/u;
  const compoundPrefix = /^[וש][הבלמכ](?=.{3})/u;
  const suffix = /(?:ימ|ות|ה|ת)$/u;
  const available = [word, word.replace(prefix, ""), word.replace(compoundPrefix, "")];
  return [...new Set(available.flatMap((form) => [form, form.replace(suffix, "")]).filter((form) => form.length >= 3))];
}

function same(left: string, right: string, fuzzy: boolean) {
  if (left === right) return true;
  if (!/^[א-ת]+$/u.test(left) || !/^[א-ת]+$/u.test(right)) return false;
  const plainLeft = left.replace(/[וי]/gu, "");
  const plainRight = right.replace(/[וי]/gu, "");
  if (plainLeft.length >= 3 && plainLeft === plainRight) return true;
  if (!fuzzy) return false;
  const length = Math.min(left.length, right.length);
  const tolerance = length <= 3 ? 0 : length <= 6 ? 1 : length <= 10 ? 2 : 3;
  return tolerance > 0 && Math.abs(left.length - right.length) <= tolerance &&
    distance(left, right) <= tolerance;
}

function matchesWindow(input: string[], answer: string[], fuzzy: boolean) {
  for (let start = 0; start < input.length; start++) {
    if (start && ["לא", "בלי"].map(normalize).includes(input[start - 1])) continue;
    const window = input.slice(start, start + answer.length);
    if (window.length === answer.length && answer.every((word, index) =>
      forms(window[index]).some((form) => same(form, word, fuzzy)))) return true;
    const joined = answer.join("");
    for (let size = 1; size <= Math.min(input.length - start, answer.length + 2); size++) {
      if (size !== answer.length && same(input.slice(start, start + size).join(""), joined, false)) return true;
    }
  }
  return false;
}

export function matchMeaning(transcript: string, answers: string[], definition: string): string | null {
  const spoken = tokens(transcript);
  if (!spoken.length || /^לא יודע(?:ת|ימ|ות)?(?: |$)/u.test(spoken.join(" "))) return null;
  for (const fuzzy of [false, true]) {
    for (const answer of answers) {
      const expected = tokens(answer);
      if (expected.length && matchesWindow(spoken, expected, fuzzy)) return answer;
    }
  }
  const definitionWords = [...new Set(tokens(definition).filter((word) => word.length >= 3 && !stopWords.has(word)))];
  if (definitionWords.length < 3) return null;
  const supported = definitionWords.filter((word) => matchesWindow(spoken, [word], false));
  return supported.length >= Math.max(3, Math.ceil(definitionWords.length * 0.75)) ? supported.join(" ") : null;
}

export function exampleParts(example: string | null, term: string) {
  if (!example) return [];
  const expected = tokens(term);
  if (!expected.length) return [{ text: example, highlighted: false, start: 0 }];
  const found = [...example.matchAll(/[\p{L}\p{M}]+(?:['״׳"][\p{L}\p{M}]+)*/gu)];
  const parts: { text: string; highlighted: boolean; start: number }[] = [];
  let cursor = 0;
  for (let index = 0; index <= found.length - expected.length; index++) {
    if (!expected.every((word, offset) => forms(normalize(found[index + offset][0]))
      .some((form) => same(form, word, false)) ||
      forms(word).some((form) => same(form, normalize(found[index + offset][0]), false)))) continue;
    const first = found[index];
    const last = found[index + expected.length - 1];
    const end = last.index + last[0].length;
    if (cursor < first.index) parts.push({ text: example.slice(cursor, first.index), highlighted: false, start: cursor });
    parts.push({ text: example.slice(first.index, end), highlighted: true, start: first.index });
    cursor = end;
    index += expected.length - 1;
  }
  if (cursor < example.length) parts.push({ text: example.slice(cursor), highlighted: false, start: cursor });
  return parts;
}
