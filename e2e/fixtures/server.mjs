import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const host = "127.0.0.1";
const authPort = 4281;
const dbPort = 4282;
const appPort = 4280;
const sessionCookie = "__Secure-neon-auth.session_token";
const otp = "123456";
const users = new Map();
const sessions = new Map();
const requestedCodes = new Set();

const auth = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${host}:${authPort}`);
  const send = (status, value) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(value));
  };
  const token = request.headers.cookie?.match(/(?:^|;\s*)__Secure-neon-auth\.session_token=([^;]+)/u)?.[1];
  const current = sessions.get(token);
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};

  switch (url.pathname) {
    case "/auth/get-session":
      return send(200, current ?? null);
    case "/auth/email-otp/send-verification-otp":
      if (!/^[^@]+@example\.test$/u.test(body.email)) return send(400, { message: "Fixture address required" });
      requestedCodes.add(body.email);
      return send(200, { success: true });
    case "/auth/sign-in/email-otp": {
      if (body.otp !== otp || !requestedCodes.delete(body.email)) return send(401, { message: "Incorrect code" });
      const now = new Date().toISOString();
      const user = users.get(body.email) ?? {
        id: randomUUID(), name: "Fixture learner", email: body.email, emailVerified: true, createdAt: now, updatedAt: now,
      };
      users.set(body.email, user);
      const session = {
        id: randomUUID(), token: randomUUID(), userId: user.id, createdAt: now, updatedAt: now,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
      sessions.set(session.token, { user, session });
      response.setHeader("Set-Cookie", `${sessionCookie}=${session.token}; Path=/; HttpOnly; Secure; SameSite=Lax`);
      return send(200, { user, session, token: session.token });
    }
    case "/auth/delete-user":
      if (!current) return send(401, { message: "Unauthorized" });
      users.delete(current.user.email);
      for (const [key, value] of sessions) if (value.user.id === current.user.id) sessions.delete(key);
      response.setHeader("Set-Cookie", `${sessionCookie}=; Path=/; HttpOnly; Secure; Max-Age=0`);
      return send(200, { success: true, message: "User deleted" });
    case "/auth/sign-out":
      sessions.delete(token);
      response.setHeader("Set-Cookie", `${sessionCookie}=; Path=/; HttpOnly; Secure; Max-Age=0`);
      return send(200, { success: true });
    default:
      return send(404, { message: "Unknown fixture endpoint" });
  }
});

const postgres = new PGlite();
for (const file of (await readdir("drizzle")).filter((name) => name.endsWith(".sql")).sort()) {
  await postgres.exec(await readFile(`drizzle/${file}`, "utf8"));
}
const { rows: [deck] } = await postgres.query("INSERT INTO decks(kind, name) VALUES ('builtin', 'אוצר') RETURNING id");
const builtIn = JSON.parse(await readFile("data/builtin-words.json", "utf8"));
for (const [index, word] of builtIn.slice(0, 40).entries()) {
  await postgres.query(
    "INSERT INTO words(deck_id, term, term_plain, definition, example, accepted_answers, unit, position, difficulty) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [deck.id, word.term, word.term.replace(/[\u0591-\u05C7]/gu, ""), word.definition, word.example,
      word.accepted_answers, word.unit, index + 1, word.difficulty],
  );
}
const database = new PGLiteSocketServer({ db: postgres, host, port: dbPort, maxConnections: 3 });
await database.start();
await new Promise((resolve, reject) => auth.once("error", reject).listen(authPort, host, resolve));

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", host, "--port", String(appPort)], {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: `postgresql://postgres:postgres@${host}:${dbPort}/postgres?sslmode=disable`,
    NEON_AUTH_BASE_URL: `http://${host}:${authPort}/auth`,
    NEON_AUTH_COOKIE_SECRET: "local-fixture-signing-secret-user-sessions-only",
    NEXT_TELEMETRY_DISABLED: "1",
  },
});

let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  server.kill();
  auth.close();
  await database.stop();
  await postgres.close();
  process.exitCode = code;
}
server.on("exit", (code) => void close(code ?? 0));
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
