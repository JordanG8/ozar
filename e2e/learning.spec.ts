import { expect, test, type Page } from "@playwright/test";
import deck from "../data/builtin-words.json";

async function signIn(page: Page, path: string, email: string) {
  await page.goto(path);
  await page.getByLabel("כתובת דוא״ל").fill(email);
  await page.getByRole("button", { name: "שליחת קוד" }).click();
  await page.getByLabel("קוד כניסה").fill("123456");
  await page.getByRole("button", { name: "כניסה", exact: true }).click();
}

async function answer(page: Page, heading: string, infinite: boolean) {
  const field = page.getByLabel("התשובה שלך");
  const meaningPrompt = page.getByText("מה המשמעות?", { exact: true });
  if (await meaningPrompt.isVisible()) {
    const entry = deck.find(({ term }) => term === heading);
    if (!entry) throw new Error(`Unexpected term: ${heading}`);
    await field.fill(entry.accepted_answers[0]);
    await page.getByRole("button", { name: "בדיקה", exact: true }).click();
  } else {
    const entry = deck.find(({ definition }) => definition === heading);
    if (!entry) throw new Error(`Unexpected definition: ${heading}`);
    await page.getByRole("button", { name: entry.term, exact: true }).click();
  }
  await expect(page.getByText(infinite ? /^(נכון|10 תשובות נכונות ברצף)$/u : /^תשובה נכונה$/u)).toBeVisible();
}

test("signs in, learns five words, practices ten answers, and saves a private session", async ({ page, browser }) => {
  await signIn(page, "/settings", "practice@example.test");
  await page.getByLabel("מילים חדשות ביום").fill("5");
  await page.getByLabel("יעד תשובות יומי").fill("10");
  await page.getByLabel("מענה כברירת מחדל").selectOption("typed");
  await page.getByRole("button", { name: "שמירת הגדרות" }).click();
  await expect(page.getByText("ההגדרות נשמרו.")).toBeVisible();
  await page.goto("/learn");
  await page.getByRole("button", { name: "התחלה או המשך" }).click();
  const heading = page.getByRole("heading", { level: 1 });
  for (const [index, word] of deck.slice(0, 5).entries()) {
    await expect(heading).toHaveText(word.term);
    await page.getByRole("button", { name: "להמשך", exact: true }).click();
    if (index < 4) await expect(heading).toHaveText(deck[index + 1].term);
  }
  for (let count = 0; count < 10; count++) {
    await expect(page.getByText(/^(מה המשמעות\?|בחרו את המילה המתאימה)$/u)).toBeVisible();
    await answer(page, await heading.innerText(), false);
    await page.getByRole("button", { name: "הכרטיס הבא" }).click();
  }
  await page.getByRole("link", { name: "לתרגול רציף" }).click();
  for (let count = 0; count < 10; count++) {
    await expect(page.getByText(/^(מה המשמעות\?|בחרו את המילה המתאימה)$/u)).toBeVisible();
    await answer(page, await heading.innerText(), true);
  }
  await page.getByRole("link", { name: "יומן תרגול" }).click();
  const latest = page.getByRole("link", { name: /תרגול רציף.*תשובות 10/u });
  await expect(latest).toHaveCount(1);
  const detailsPath = (await latest.getAttribute("href"))!;
  await latest.click();
  await expect(page.locator("main").getByRole("listitem")).toHaveCount(10);
  await page.goto("/");
  await expect(page).toHaveURL(/\/infinite$/u);

  const other = await browser.newPage();
  try {
    await signIn(other, "/sessions", "other@example.test");
    await expect(other.getByText("אין אימונים להצגה כאן.")).toBeVisible();
    await other.goto(detailsPath);
    await expect(other.locator("main").getByRole("listitem")).toHaveCount(0);
    await expect(other.getByRole("heading", { name: "תרגול רציף" })).toHaveCount(0);
  } finally {
    await other.close();
  }
});

test("imports a private CSV, exports the learner's data, and deletes the fixture account", async ({ page }) => {
  const email = "import@example.test";
  await signIn(page, "/decks/import", email);
  const file = page.getByLabel("קובץ מילים");
  await expect(file).toBeEnabled();
  await file.setInputFiles({
    name: "חפיסה.csv", mimeType: "text/csv",
    buffer: Buffer.from('הגדרה,מילה\n"חזק, יציב",איתן\n,חסר\n'),
  });
  await expect(page.getByText("חסרה הגדרה")).toBeVisible();
  await page.getByRole("button", { name: "שמירת 1 מילים" }).click();
  await page.getByRole("link", { name: "ללימוד החפיסה" }).click();
  await page.getByRole("button", { name: "התחלה או המשך" }).click();
  await expect(page.getByRole("heading", { name: "איתן" })).toBeVisible();
  await page.goto("/settings");
  const exported = await page.request.post("/api/settings", { data: { action: "export" } });
  expect(exported.ok()).toBe(true);
  const data = await exported.json();
  expect(data.profile.email).toBe(email);
  expect(data.words).toHaveLength(1);
  expect(data.words[0].acceptedAnswers).toEqual(["חזק", "יציב"]);
  await page.getByRole("button", { name: "מחיקת חשבון", exact: true }).click();
  await page.getByLabel("הקלידו את כתובת הדוא״ל לאישור").fill(email);
  await page.getByRole("button", { name: "מחיקת החשבון לצמיתות" }).click();
  await expect(page).toHaveURL(/menu=1/u);
  const after = await page.request.post("/api/settings", { data: { action: "export" } });
  expect(after.status()).toBe(401);
  await signIn(page, "/learn", email);
  await expect(page.getByRole("button", { name: "התחלה או המשך" })).toBeVisible();
  await expect(page.getByLabel("חפיסה ללימוד")).toHaveCount(0);
});
