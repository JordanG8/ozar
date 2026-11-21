import { createGateway } from "ai";
import { getNeonAuth } from "@/lib/neon-auth";
import { voiceModel } from "@/lib/learn/voice-audio";

const baseURL = process.env.OZAR_AI_GATEWAY_BASE_URL?.replace(/\/+$/u, "") || "https://ai-gateway.vercel.sh/v4/ai";
const gateway = createGateway({ baseURL });

// Mints a single-use, short-lived AI Gateway secret so the browser can stream mic audio
// straight to the transcription WebSocket while the learner holds the mic. The Gateway key stays here.
export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "forbidden" }, { status: 403 });
  try {
    const auth = getNeonAuth();
    if (!auth) return Response.json({ error: "unavailable" }, { status: 503 });
    if (!(await auth.getSession()).data?.user) return Response.json({ error: "unauthenticated" }, { status: 401 });
    const { token, expiresAt } = await gateway.experimental_transcription.getToken({ model: voiceModel, expiresAfterSeconds: 300 });
    return Response.json({ token, baseURL, expiresAt: expiresAt ?? Math.floor(Date.now() / 1000) + 60 },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.warn("Voice token failed", { type: error instanceof Error ? error.name : "unknown" });
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
