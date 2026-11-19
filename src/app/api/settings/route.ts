import { getNeonAuth } from "@/lib/neon-auth";
import { LearnerUnauthorized } from "@/lib/learn/store";
import { deleteAccount, exportData, savePreferences, validatePreferences } from "@/lib/settings";

class DeletionRejected extends Error {
  constructor(readonly status: number) { super("Account deletion rejected"); }
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "invalid" }, { status: 400 });
  if (request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "forbidden" }, { status: 403 });
  const auth = getNeonAuth();
  if (!auth) return Response.json({ error: "unavailable" }, { status: 503 });
  try {
    const raw = await request.text();
    if (raw.length > 2048) return Response.json({ error: "invalid" }, { status: 400 });
    let payload;
    try { payload = JSON.parse(raw); } catch { return Response.json({ error: "invalid" }, { status: 400 }); }
    if (!payload || typeof payload !== "object") return Response.json({ error: "invalid" }, { status: 400 });
    const user = (await auth.getSession({ query: { disableCookieCache: "true" } })).data?.user;
    if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });
    if (payload.action === "save") {
      const preferences = validatePreferences(payload.preferences);
      if (!preferences) return Response.json({ error: "invalid" }, { status: 400 });
      await savePreferences(user.id, preferences);
      return Response.json({ saved: true });
    }
    if (payload.action === "export") {
      const data = await exportData(user.id);
      return Response.json({
        version: 1, exportedAt: new Date().toISOString(), profile: { id: user.id, name: user.name, email: user.email }, ...data,
      }, { headers: { "Cache-Control": "no-store", "Content-Disposition": 'attachment; filename="ozar-data.json"' } });
    }
    if (payload.action === "delete" && payload.email === user.email && payload.confirmed === true) {
      await deleteAccount(user.id, async () => {
        const { data, error } = await auth.deleteUser({});
        if (error || !data?.success || data.message !== "User deleted") {
          throw new DeletionRejected(error?.status === 400 || error?.status === 401 || error?.status === 403 ? 409 : 503);
        }
      });
      return Response.json({ deleted: true });
    }
    return Response.json({ error: "invalid" }, { status: 400 });
  } catch (error) {
    if (error instanceof LearnerUnauthorized) return Response.json({ error: "unauthenticated" }, { status: 401 });
    if (error instanceof DeletionRejected) return Response.json({ error: "deletion_rejected" }, { status: error.status });
    console.error("Settings request failed", { type: error instanceof Error ? error.name : "unknown" });
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
