# אוצר · Ozar

Ozar is a Hebrew vocabulary trainer for the Israeli psychometric exam. It includes 2,001 reviewed entries, guided Learn, continuous practice, session history, and private spreadsheet imports.

## Development

Use Node.js 24 or later. Set `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_AUTH_BASE_URL`, and `NEON_AUTH_COOKIE_SECRET` for your development environment.

```sh
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

Vercel runs migrations and seeds the built-in deck before the Next.js build. The seed upserts by deck and position. The source PDF and editorial working files stay local.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium --only-shell
npm run test:e2e
```

Vitest tests the scheduler, Hebrew matcher, and spreadsheet parser. The database tests run against PGlite. Playwright exercises the production build over HTTP with a disposable PGlite database and local fixtures for email-code auth and AI Gateway. GitHub Actions runs the same checks.

## Meaning judge

The deterministic matcher handles live speech results. On submission or speech end, unmatched answers go to Gemini Decision 1 through Vercel AI Gateway. The app sends the term, definition, and submitted text. The judge function runs in Frankfurt and uses Vercel OIDC. Accepted paraphrases are remembered for the current account and word. Partial grades count as correct and receive at most Hard. When the judge times out, the learner can grade the card manually.

On Android, Ozar captures short recordings directly and sends them to GPT Transcribe through AI Gateway at the end of speech. The first capture begins when the learner taps the mic. Audio is released before transcription, and Ozar saves the transcript with the answer. The recording is not stored in Ozar.

## Session metrics

Accuracy is the number of correct answers divided by the number of graded answers. Learn introductions are excluded. Session difficulty is the response-time-weighted mean of FSRS difficulty on its 1–10 scale. Each answer uses post-review difficulty when scheduling is applied and the current difficulty when scheduling is skipped. The weight is response time in milliseconds with a minimum of 250 ms. The calculation is `sum(difficulty × weight) / sum(weight)`.

Installed copies use the same online service. The service worker stores a static offline message. Study and account data are saved in Neon.
