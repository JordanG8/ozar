import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
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
const spokenAnswer = "אבן לחידוד סכינים";
let mintedSecrets = 0;

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
    case "/v1/realtime/client-secrets":
      if (request.headers.authorization !== "Bearer local-fixture-gateway-key" || body.model !== "openai/gpt-transcribe" ||
        body.routeKind !== "transcription") {
        return send(400, { error: { message: "Invalid client secret request" } });
      }
      return send(200, { token: `vcst_fixture${++mintedSecrets}`, expiresAt: Math.floor(Date.now() / 1000) + (body.expiresIn ?? 60) });
    case "/gateway/transcription-model": {
      const audio = Buffer.from(body.audio ?? "", "base64");
      if (request.headers["ai-model-id"] !== "openai/gpt-transcribe" || body.mediaType !== "audio/wav" ||
        body.providerOptions?.openai?.languages?.[0] !== "he" || audio.toString("ascii", 0, 4) !== "RIFF" ||
        audio.readUInt32LE(24) !== 24000) {
        return send(400, { error: { message: "Invalid Hebrew audio request" } });
      }
      return send(200, { text: spokenAnswer });
    }
    case "/gateway/decision-model":
      if (request.headers["ai-model-id"] !== "google/gemini-decision-1" || body.questions?.verdict?.type !== "choice") {
        return send(400, { error: { message: "Invalid decision request" } });
      }
      if (JSON.stringify(body.stateParts).includes("מבחן פסק זמן")) {
        await new Promise((resolve) => setTimeout(resolve, 3700));
      }
      return send(200, { answers: { verdict: { type: "choice", choice: "correct" } } });
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

// A minimal AI Gateway streaming-transcription WebSocket: the browser streams PCM while the mic is held.
const usedSecrets = new Set();
function sendFrame(socket, text) {
  const payload = Buffer.from(text);
  const header = payload.length < 126 ? Buffer.from([0x81, payload.length])
    : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]);
  socket.write(Buffer.concat([header, payload]));
}
auth.on("upgrade", (request, socket) => {
  const url = new URL(request.url, `http://${host}:${authPort}`);
  const protocols = (request.headers["sec-websocket-protocol"] ?? "").split(",").map((value) => value.trim());
  const secret = protocols.find((value) => value.startsWith("ai-gateway-auth."))?.slice(16);
  if (url.pathname !== "/gateway/transcription-model" || url.searchParams.get("ai-model-id") !== "openai/gpt-transcribe" ||
    !protocols.includes("ai-gateway-transcription.v1") || !secret?.startsWith("vcst_fixture") || usedSecrets.has(secret)) {
    socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return;
  }
  usedSecrets.add(secret);
  const accept = createHash("sha1").update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`, "Sec-WebSocket-Protocol: ai-gateway-transcription.v1", "", ""].join("\r\n"));
  let buffered = Buffer.alloc(0);
  let started = false;
  let audioBytes = 0;
  socket.on("error", () => {});
  socket.on("data", (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 2) {
      const opcode = buffered[0] & 15;
      let length = buffered[1] & 127;
      let offset = 2;
      if (length === 126) { length = buffered.readUInt16BE(2); offset = 4; }
      else if (length === 127) { length = Number(buffered.readBigUInt64BE(2)); offset = 10; }
      if (buffered.length < offset + 4 + length) return;
      const mask = buffered.subarray(offset, offset + 4);
      const payload = Buffer.from(buffered.subarray(offset + 4, offset + 4 + length));
      for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index % 4];
      buffered = buffered.subarray(offset + 4 + length);
      if (opcode === 8) { socket.end(); return; }
      if (opcode === 2) {
        if (!started) { socket.end(); return; }
        // The first audio arrives while the mic is still held: show a live partial transcript.
        if (!audioBytes) sendFrame(socket, JSON.stringify({ type: "transcript-partial", text: "אבן" }));
        audioBytes += payload.length;
        continue;
      }
      if (opcode !== 1) continue;
      const frame = JSON.parse(payload.toString());
      if (frame.type === "transcription-stream.start") {
        started = frame.inputAudioFormat?.type === "audio/pcm" && frame.inputAudioFormat?.rate === 24000 &&
          frame.providerOptions?.openai?.languages?.[0] === "he";
        if (!started) sendFrame(socket, JSON.stringify({ type: "error", error: { message: "Invalid start frame" } }));
      } else if (frame.type === "transcription-stream.audio-done") {
        sendFrame(socket, JSON.stringify({ type: "transcript-final", text: spokenAnswer }));
        sendFrame(socket, JSON.stringify({ type: "finish", text: spokenAnswer, segments: [], durationInSeconds: audioBytes / 48000 }));
      }
    }
  });
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
    OZAR_AI_GATEWAY_BASE_URL: `http://${host}:${authPort}/gateway`,
    AI_GATEWAY_API_KEY: "local-fixture-gateway-key",
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
