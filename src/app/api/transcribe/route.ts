import { createGateway, transcribe } from "ai";
import { getNeonAuth } from "@/lib/neon-auth";
import { isVoiceClip, maxVoiceBytes, voiceModel, voiceProviderOptions } from "@/lib/learn/voice-audio";

const model = createGateway({ baseURL: process.env.OZAR_AI_GATEWAY_BASE_URL })
  .transcriptionModel(voiceModel);

// Fallback for when the streaming WebSocket fails: the client uploads the clip it captured.
export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "forbidden" }, { status: 403 });
  if (request.headers.get("content-type") !== "audio/wav") return Response.json({ error: "invalid_audio" }, { status: 415 });
  if (Number(request.headers.get("content-length")) > maxVoiceBytes) return Response.json({ error: "audio_too_long" }, { status: 413 });
  try {
    const auth = getNeonAuth();
    if (!auth) return Response.json({ error: "unavailable" }, { status: 503 });
    if (!(await auth.getSession()).data?.user) return Response.json({ error: "unauthenticated" }, { status: 401 });
    const audio = await request.arrayBuffer();
    if (!isVoiceClip(audio)) return Response.json({ error: "invalid_audio" }, { status: 400 });
    const { text } = await transcribe({
      audio, model, maxRetries: 0, providerOptions: voiceProviderOptions,
      abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
    });
    return Response.json({ text: text.trim().slice(0, 300) });
  } catch (error) {
    console.warn("Voice transcription failed", { type: error instanceof Error ? error.name : "unknown" });
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
