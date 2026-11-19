import { getNeonAuth } from "@/lib/neon-auth";
import { saveDeck } from "@/lib/import/decks";
import { cleanImportWord, maxImportBytes, maxImportRows } from "@/lib/import/rows";
import { StudyConflict } from "@/lib/learn/store";

const invalid = () => Response.json({ error: "invalid" }, { status: 400 });

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return invalid();
  if (request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "forbidden" }, { status: 403 });
  try {
    const user = (await getNeonAuth()?.getSession())?.data?.user;
    if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });
    if (Number(request.headers.get("content-length")) > maxImportBytes) return invalid();
    const raw = await request.text();
    if (Buffer.byteLength(raw) > maxImportBytes) return invalid();
    let payload;
    try { payload = JSON.parse(raw); } catch { return invalid(); }
    if (!payload || typeof payload !== "object") return invalid();
    const { id, name, rows } = payload;
    if (typeof id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(id) ||
      typeof name !== "string" || !name.trim() || name.length > 100 || name.includes("\u0000") ||
      !Array.isArray(rows) || !rows.length || rows.length > maxImportRows) return invalid();
    const entries = rows.map(cleanImportWord);
    if (entries.some((word) => word === null) ||
      new Set(entries.map((word) => JSON.stringify([word?.term, word?.definition]))).size !== entries.length) return invalid();
    return Response.json(await saveDeck(user.id, id, name.trim(), entries.filter((word) => word !== null)), { status: 201 });
  } catch (error) {
    if (error instanceof StudyConflict) return Response.json({ error: "conflict" }, { status: 409 });
    console.error("Deck import failed", { type: error instanceof Error ? error.name : "unknown" });
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
