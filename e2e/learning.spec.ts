import { expect, test, type Page } from "@playwright/test";
import deck from "../data/builtin-words.json";

async function signIn(page: Page, path: string, email: string) {
  await page.goto(path);
  await page.getByRole("button", { name: "כניסה עם קוד למייל" }).click();
  await page.getByLabel("כתובת דוא״ל").fill(email);
  await page.getByRole("button", { name: "שליחת קוד" }).click();
  await page.getByLabel("קוד כניסה").fill("123456");
  await page.getByRole("button", { name: "כניסה", exact: true }).click();
}

const openCard = (page: Page) => page.locator("[data-kind]:not([data-verdict])");

async function waitForPrompt(page: Page) {
  await expect(openCard(page)).toHaveAttribute("data-kind", /^(voice_meaning|reverse_choice)$/u);
}

async function answer(page: Page, heading: string) {
  const field = page.getByLabel("התשובה שלך");
  if (await openCard(page).getAttribute("data-kind") === "voice_meaning") {
    const entry = deck.find(({ term }) => term === heading);
    if (!entry) throw new Error(`Unexpected term: ${heading}`);
    await field.fill(entry.accepted_answers[0]);
    await page.getByRole("button", { name: "בדיקה", exact: true }).click();
  } else {
    const entry = deck.find(({ definition }) => definition === heading);
    if (!entry) throw new Error(`Unexpected definition: ${heading}`);
    await page.getByRole("button", { name: entry.term, exact: true }).click();
  }
  await expect(page.locator("[data-verdict]")).toHaveAttribute("data-verdict", "correct");
}

test("signs in, learns five words, practices ten answers, and saves a private session", async ({ page, browser }) => {
  await signIn(page, "/settings", "practice@example.test");
  await page.getByLabel("מילים חדשות ביום").fill("5");
  await page.getByLabel("יעד יומי").fill("10");
  await page.getByRole("radio", { name: "מקלדת" }).check();
  await expect(page.getByText("נשמר", { exact: true })).toBeVisible();
  await page.goto("/learn");
  await page.getByRole("button", { name: "התחלה או המשך" }).click();
  const heading = page.getByRole("heading", { level: 1 });
  for (const [index, word] of deck.slice(0, 5).entries()) {
    await expect(heading).toHaveText(word.term);
    await page.getByRole("button", { name: "הבנתי", exact: true }).click();
    if (index < 4) await expect(heading).toHaveText(deck[index + 1].term);
  }
  for (let count = 0; count < 10; count++) {
    await waitForPrompt(page);
    await answer(page, await heading.innerText());
    await page.getByRole("button", { name: "הכרטיס הבא" }).click();
  }
  await page.getByRole("link", { name: "להמשיך לאינסופי" }).click();
  for (let count = 0; count < 10; count++) {
    await waitForPrompt(page);
    await answer(page, await heading.innerText());
    // Nothing moves on by itself: the card waits until the disk is tapped.
    await page.waitForTimeout(count === 0 ? 1500 : 0);
    await expect(page.locator("[data-verdict]")).toHaveAttribute("data-verdict", "correct");
    if (count < 9) await page.getByRole("button", { name: "לכרטיס הבא" }).click();
  }
  await page.getByRole("button", { name: "סיום סשן" }).click();
  await expect(page).toHaveURL(/\/summary$/u);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("10");
  await page.goto("/sessions");
  const latest = page.getByRole("link", { name: /אינסופי.*10 תשובות/u });
  await expect(latest).toHaveCount(1);
  const detailsPath = (await latest.getAttribute("href"))!;
  await latest.click();
  await expect(page.locator("main:visible li")).toHaveCount(10);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "סיימת להיום" })).toBeVisible();
  await expect(page.getByRole("link", { name: "להמשיך באינסופי" })).toBeVisible();

  const other = await browser.newPage();
  try {
    await signIn(other, "/sessions", "other@example.test");
    await expect(other.getByText("עוד אין כאן כלום")).toBeVisible();
    await other.goto(detailsPath);
    await expect(other.locator("main:visible li")).toHaveCount(0);
    await expect(other.getByText(/אינסופי ·/u)).toHaveCount(0);
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
  await page.getByRole("button", { name: "ייבוא 1 מילים" }).click();
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

// A fake microphone: a tone that plays while the learner holds the mic. Counts every opening.
async function installMicrophone(page: Page) {
  await page.addInitScript(() => {
    const NativeAudioContext = AudioContext;
    const probe = { opens: 0, streams: [] as MediaStream[] };
    Object.assign(window, { micProbe: probe });
    navigator.mediaDevices.getUserMedia = async () => {
      probe.opens++;
      const context = new NativeAudioContext();
      await context.resume();
      const output = context.createMediaStreamDestination();
      const tone = context.createOscillator();
      const gain = context.createGain();
      gain.gain.value = 0.25;
      tone.connect(gain).connect(output);
      tone.start();
      probe.streams.push(output.stream);
      output.stream.getTracks().forEach((track) => {
        const stop = track.stop.bind(track);
        track.stop = () => { stop(); void context.close(); };
      });
      return output.stream;
    };
  });
}

const micProbe = (page: Page) => page.evaluate(() => {
  const { opens, streams } = (window as unknown as { micProbe: { opens: number; streams: MediaStream[] } }).micProbe;
  return { opens, tracks: streams.flatMap((stream) => stream.getTracks().map((track) => track.readyState)) };
});

async function holdMic(page: Page, whileHeld: () => Promise<void>) {
  const box = await page.getByRole("button", { name: /^מענה בקול · /u }).boundingBox();
  if (!box) throw new Error("Mic button is not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByText("מקשיב · שחררו לסיום", { exact: true })).toBeVisible();
  await whileHeld();
  await page.mouse.up();
}

async function openPractice(page: Page, email: string) {
  await signIn(page, "/learn", email);
  await page.getByRole("button", { name: "התחלה או המשך" }).click();
  await page.getByRole("button", { name: "הבנתי", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(deck[1].term);
  await page.goto("/infinite");
}

test("streams held speech to the gateway, judges it on release, and permits a single-tap timeout grade", async ({ page }) => {
  await installMicrophone(page);
  await openPractice(page, "spoken-judge@example.test");
  const mic = page.getByRole("button", { name: /^מענה בקול · /u });
  await expect(mic).toBeVisible();
  await expect(page.getByText("ההקלטה נשלחת לתמלול בזמן ההחזקה.")).toBeVisible();
  await page.waitForTimeout(500);
  expect((await micProbe(page)).opens).toBe(0);

  await mic.click();
  await expect(page.getByText("יש להחזיק את הכפתור בזמן הדיבור.")).toBeVisible();
  expect(await micProbe(page)).toEqual({ opens: 1, tracks: ["ended"] });

  let judgeRequests = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/judge")) judgeRequests++; });
  await holdMic(page, async () => {
    // The gateway answers the first streamed audio with a partial transcript while the mic is still held.
    await expect(page.getByText("אבן", { exact: true })).toBeVisible();
    await page.waitForTimeout(600);
    expect(judgeRequests).toBe(0);
  });
  await expect(page.getByText(deck[0].definition, { exact: true })).toBeVisible();
  expect(judgeRequests).toBe(1);
  expect(await micProbe(page)).toEqual({ opens: 2, tracks: ["ended", "ended"] });

  await page.getByRole("button", { name: "לכרטיס הבא" }).click();
  await expect(mic).toBeVisible();
  await page.waitForTimeout(500);
  expect((await micProbe(page)).opens).toBe(2);
  await page.getByRole("button", { name: "מענה בהקלדה" }).click();
  await page.getByLabel("התשובה שלך").fill("מבחן פסק זמן");
  await page.getByRole("button", { name: "בדיקה", exact: true }).click();
  const self = page.getByRole("button", { name: "צדקתי", exact: true });
  await expect(self).toBeVisible({ timeout: 5000 });
  await self.click();
  await expect(page.locator("[data-verdict]")).toHaveAttribute("data-verdict", "correct");
  const data = await (await page.request.post("/api/settings", { data: { action: "export" } })).json();
  expect(data.reviews).toEqual(expect.arrayContaining([
    expect.objectContaining({ input: "voice", correct: true, transcript: "אבן לחידוד סכינים" }),
    expect.objectContaining({ judge: expect.objectContaining({ status: "timeout", selfGrade: true }) }),
  ]));
});

test("uploads the held clip when the streaming socket fails", async ({ page }) => {
  await installMicrophone(page);
  await page.routeWebSocket(/\/gateway\/transcription-model/u, (socket) => socket.close());
  await openPractice(page, "stream-fallback@example.test");
  const transcription = page.waitForResponse((response) => response.url().endsWith("/api/transcribe"));
  await holdMic(page, () => page.waitForTimeout(700));
  expect((await transcription).status()).toBe(200);
  await expect(page.getByText(deck[0].definition, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "לכרטיס הבא" })).toBeEnabled();
  expect(await micProbe(page)).toEqual({ opens: 1, tracks: ["ended"] });
});
