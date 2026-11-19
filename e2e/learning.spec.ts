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

async function installSpeechFixture(page: Page) {
  await page.addInitScript(() => {
    const probe = { starts: 0, aborted: 0 };
    Object.assign(window, { speechProbe: probe });
    class SpeechFixture {
      onaudiostart?: () => void;
      onaudioend?: () => void;
      onresult?: (event: { resultIndex: number; results: ArrayLike<unknown> }) => void;
      onspeechend?: () => void;
      onerror?: (event: { error: string }) => void;
      onend?: () => void;
      start() {
        probe.starts++;
        Object.assign(window, { fixtureSpeech: this });
        queueMicrotask(() => this.onaudiostart?.());
      }
      abort() { probe.aborted++; }
      stop() { this.onaudioend?.(); this.onspeechend?.(); }
      silence() {
        this.onaudioend?.();
        this.onerror?.({ error: "no-speech" });
        this.onend?.();
      }
    }
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: SpeechFixture });
  });
}

test("judges an interim speech transcript at speech end and permits a single-tap timeout grade", async ({ page }) => {
  await installSpeechFixture(page);
  await signIn(page, "/learn", "spoken-judge@example.test");
  await page.getByRole("button", { name: "התחלה או המשך" }).click();
  await page.getByRole("button", { name: "הבנתי", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(deck[1].term);
  await page.goto("/infinite");
  await expect(page.getByRole("button", { name: "עצירת הקלטה" })).toBeVisible();
  const paraphrase = "אבן שאיתה משחיזים סכינים להיות חדים יותר";
  let judgeRequests = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/judge")) judgeRequests++; });
  const interim = page.waitForResponse((response) => response.url().endsWith("/api/learn") &&
    response.request().postDataJSON()?.input?.final === false);
  await page.evaluate((transcript) => {
    const speech = (window as unknown as {
      fixtureSpeech: { onresult: (event: { resultIndex: number; results: unknown[] }) => void };
    }).fixtureSpeech;
    speech.onresult({ resultIndex: 0, results: [{ 0: { transcript }, length: 1, isFinal: false }] });
  }, paraphrase);
  expect((await (await interim).json()).accepted).toBe(false);
  expect(judgeRequests).toBe(0);
  await page.evaluate(() => {
    (window as unknown as { fixtureSpeech: { onspeechend: () => void } }).fixtureSpeech.onspeechend();
  });
  await expect(page.getByText(deck[0].definition, { exact: true })).toBeVisible();
  expect(judgeRequests).toBe(1);

  await page.getByRole("button", { name: "מענה בהקלדה" }).click();
  await page.getByLabel("התשובה שלך").fill("מבחן פסק זמן");
  await page.getByRole("button", { name: "בדיקה", exact: true }).click();
  const self = page.getByRole("button", { name: "צדקתי", exact: true });
  await expect(self).toBeVisible({ timeout: 5000 });
  await self.click();
  await expect(page.locator("[data-verdict]")).toHaveAttribute("data-verdict", "correct");
  const data = await (await page.request.post("/api/settings", { data: { action: "export" } })).json();
  expect(data.reviews).toEqual(expect.arrayContaining([
    expect.objectContaining({ judge: expect.objectContaining({ model: "google/gemini-decision-1", status: "decided", input: paraphrase }) }),
    expect.objectContaining({ judge: expect.objectContaining({ status: "timeout", selfGrade: true }) }),
  ]));
});

test("stops listening on a wrong answer and lets the learner restart after silence", async ({ page }) => {
  await installSpeechFixture(page);
  await signIn(page, "/learn", "quiet-mic@example.test");
  await page.getByRole("button", { name: "התחלה או המשך" }).click();
  await page.getByRole("button", { name: "הבנתי", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(deck[1].term);
  await page.goto("/infinite");
  const micOn = page.getByText("המיקרופון פעיל", { exact: true });
  const micOff = page.getByText("המיקרופון כבוי", { exact: true });
  await expect(micOn).toBeVisible();
  await page.clock.install();
  await page.evaluate(() => {
    (window as unknown as { fixtureSpeech: { silence: () => void } }).fixtureSpeech.silence();
  });
  await expect(micOff).toBeVisible();
  await expect(page.getByText(/לא נקלט דיבור/u)).toBeVisible();
  await page.clock.runFor(1500);
  const started = () => page.evaluate(() => (window as unknown as { speechProbe: { starts: number } }).speechProbe.starts);
  expect(await started()).toBe(1);

  await page.getByRole("button", { name: "מענה בקול" }).click();
  await expect(micOn).toBeVisible();
  await page.getByRole("button", { name: "לא יודע", exact: true }).click();
  const definition = page.getByText(deck[0].definition, { exact: true });
  await expect(definition).toBeVisible();
  await expect(micOff).toBeVisible();
  await definition.click();
  await page.clock.runFor(1500);
  await expect(definition).toBeVisible();
  expect(await started()).toBe(2);

  await page.getByRole("button", { name: "לכרטיס הבא" }).click();
  await expect(micOn).toBeVisible();
  expect(await started()).toBe(3);
});

test("Android captures a quiet clip, releases the mic, and grades its transcription", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeAudioContext = AudioContext;
    Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (Linux; Android 14) Chrome/152.0" });
    const probe = { nativeStarts: 0, streams: [] as MediaStream[] };
    Object.assign(window, { quietProbe: probe });
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: class {
      start() { probe.nativeStarts++; }
      abort() {}
    } });
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new NativeAudioContext();
      await context.resume();
      const output = context.createMediaStreamDestination();
      const tone = context.createOscillator();
      const gain = context.createGain();
      gain.gain.value = 0.25;
      tone.connect(gain).connect(output);
      tone.start(context.currentTime + 0.1);
      tone.stop(context.currentTime + 0.45);
      probe.streams.push(output.stream);
      output.stream.getTracks().forEach((track) => {
        const stop = track.stop.bind(track);
        track.stop = () => { stop(); void context.close(); };
      });
      return output.stream;
    };
  });
  await signIn(page, "/learn", "quiet-android@example.test");
  await page.getByRole("button", { name: "התחלה או המשך" }).click();
  await page.getByRole("button", { name: "הבנתי", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(deck[1].term);
  await page.goto("/infinite");
  await expect(page.getByText("הקלטות קצרות נשלחות לתמלול.")).toBeVisible();
  const probe = () => page.evaluate(() => {
    const { nativeStarts, streams } = (window as unknown as {
      quietProbe: { nativeStarts: number; streams: MediaStream[] };
    }).quietProbe;
    return { nativeStarts, tracks: streams.flatMap((stream) => stream.getTracks().map((track) => track.readyState)) };
  });
  expect(await probe()).toEqual({ nativeStarts: 0, tracks: [] });
  const transcription = page.waitForResponse((response) => response.url().endsWith("/api/transcribe"));
  await page.getByRole("button", { name: "מענה בקול", exact: true }).click();
  await expect(page.getByText("המיקרופון פעיל", { exact: true })).toBeVisible();
  expect((await transcription).status()).toBe(200);
  await expect(page.getByText(deck[0].definition, { exact: true })).toBeVisible();
  await expect(page.getByText("המיקרופון כבוי", { exact: true })).toBeVisible();
  expect(await probe()).toEqual({ nativeStarts: 0, tracks: ["ended"] });
});
