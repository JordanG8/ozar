import { describe, expect, it } from "vitest";
import { exampleParts, matchMeaning } from "./matcher";

describe("Hebrew meaning matching", () => {
  it.each([
    ["גַּנָּן", "גננ"],
    ["זה עיקרון מסוים", "עקרון"],
    ["לשומרים", "שומר"],
    ["אז זה חסר ניסיון בעיניי", "חסר ניסיון"],
    ["חדמשמעי", "חד משמעי"],
    ["שח צן", "שחצן"],
    ["זה יהיר", "יהיר"],
  ])("matches %s to %s", (typed, answer) => {
    expect(matchMeaning(typed, ["זללן", answer], "")).toBe(answer);
  });

  it("prefers the exact answer across synonyms", () => {
    expect(matchMeaning("סוחר", ["סופר", "סוחר"], "")).toBe("סוחר");
  });

  it("accepts a full paraphrase when it covers the definition's content", () => {
    expect(matchMeaning("בהמות שותות מתוך כלי עמוק", ["שוקת חקלאית"], "כלי עמוק שממנו שותות בהמות")).not.toBeNull();
  });

  it.each(["חתול", "לא יודע", "לא יודעת, אולי מאיים", "זה ממש לא מפחיד", "אור"])(
    "rejects an unrelated, unknown, or negated meaning (%s)",
    (typed) => expect(matchMeaning(typed, ["מאיים", "מפחיד", "אש"], "דבר שמעורר פחד רב")).toBeNull(),
  );
});

it("blanks every recognizable occurrence in a multi-sense example", () => {
  const parts = exampleParts("מול הדלת עמד נושה, והנושה ביקש לדבר.", "נוֹשֶׁה");
  expect(parts.filter((part) => part.highlighted).map((part) => part.text)).toEqual(["נושה", "והנושה"]);
  expect(parts.map((part) => part.text).join("")).toBe("מול הדלת עמד נושה, והנושה ביקש לדבר.");
});
