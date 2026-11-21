"use client";

import { createGateway, experimental_streamTranscribe as streamTranscribe } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  encodePcm16, encodeVoiceClip, maxVoiceSeconds, minVoiceSamples, voiceModel, voiceProviderOptions, voiceSampleRate,
} from "@/lib/learn/voice-audio";

type Phase = "off" | "opening" | "listening" | "finishing";
type Ticket = { token: string; baseURL: string; expiresAt: number };

type Capture = {
  controller: AbortController;
  stream?: MediaStream;
  source?: MediaStreamAudioSourceNode;
  worklet?: AudioWorkletNode;
  audio?: ReadableStreamDefaultController<Uint8Array>;
  transcript?: Promise<string>;
  timer?: number;
  frames: Float32Array[];
  samples: number;
  voiced: number;
  released: boolean;
};

const noSpeech = "לא נקלט דיבור. אפשר לנסות שוב.";
const holdToTalk = "יש להחזיק את הכפתור בזמן הדיבור.";
const failed = "התמלול לא הצליח. אפשר לנסות שוב או להקליד תשובה.";
// After release the Gateway only has to finish the turn. Fall back to uploading the clip if it stalls.
const streamGraceMs = 3500;

async function fetchTicket(): Promise<Ticket> {
  const response = await fetch("/api/transcribe/token", { method: "POST" });
  if (!response.ok) throw new Error("Voice token request failed");
  return response.json();
}

function closeAudio(capture: Capture) {
  try { capture.audio?.close(); } catch { /* Already closed or errored. */ }
  capture.audio = undefined;
}

function releaseMicrophone(capture: Capture) {
  window.clearTimeout(capture.timer);
  if (capture.worklet) {
    capture.worklet.port.onmessage = null;
    capture.worklet.disconnect();
  }
  capture.source?.disconnect();
  capture.stream?.getTracks().forEach((track) => track.stop());
  capture.stream = undefined;
  capture.source = undefined;
  capture.worklet = undefined;
}

async function transcribeClip(capture: Capture) {
  const response = await fetch("/api/transcribe", {
    method: "POST", headers: { "Content-Type": "audio/wav" },
    body: encodeVoiceClip(capture.frames, capture.samples),
    signal: AbortSignal.any([capture.controller.signal, AbortSignal.timeout(7000)]),
  });
  if (!response.ok) throw new Error("Transcription request failed");
  const { text }: { text: string } = await response.json();
  return text;
}

// Push to talk: the mic opens only while the learner holds the button. From the press on, PCM frames stream
// over a WebSocket to AI Gateway, so when the learner lets go only the end of the turn is left to transcribe.
export function useSpeech(
  promptId: string | null,
  enabled: boolean,
  onSpeech: (alternatives: string[], ended: boolean) => void,
) {
  const [phase, setPhase] = useState<Phase>("off");
  const [speechError, setSpeechError] = useState("");
  const [used, setUsed] = useState(false);
  const active = useRef<Capture | null>(null);
  const context = useRef<AudioContext | null>(null);
  const worklet = useRef<Promise<void> | null>(null);
  const ticket = useRef<Promise<Ticket> | null>(null);
  const listener = useRef(onSpeech);
  useEffect(() => { listener.current = onSpeech; }, [onSpeech]);

  const wanted = useRef(false);
  useEffect(() => { wanted.current = enabled; }, [enabled]);

  const prepare = useCallback(function prepare() {
    // Warm up everything that does not need the mic, so a press goes straight to capture.
    try {
      context.current ??= new AudioContext();
      if (!worklet.current) {
        const loading = context.current.audioWorklet.addModule("/voice-capture.js");
        worklet.current = loading;
        loading.catch(() => { if (worklet.current === loading) worklet.current = null; });
      }
    } catch {
      // The press reports the error.
    }
    const pending = ticket.current;
    if (!pending) {
      const next = fetchTicket();
      ticket.current = next;
      next.then((value) => {
        // Gateway secrets are short-lived. Drop one before it expires so the next press mints a fresh one.
        const wait = value.expiresAt * 1000 - Date.now() - 15_000;
        window.setTimeout(() => {
          if (ticket.current !== next) return;
          ticket.current = null;
          if (wanted.current) prepare();
        }, Math.max(0, wait));
      }, () => { if (ticket.current === next) ticket.current = null; });
    }
  }, []);

  const takeTicket = useCallback(async () => {
    const pending = ticket.current ?? fetchTicket();
    ticket.current = null;
    const value = await pending;
    return value.expiresAt * 1000 - Date.now() > 3000 ? value : fetchTicket();
  }, []);

  const stop = useCallback(() => {
    const capture = active.current;
    active.current = null;
    if (capture) {
      capture.controller.abort();
      releaseMicrophone(capture);
      try { capture.audio?.error(new Error("Stopped")); } catch { /* Already closed. */ }
      capture.audio = undefined;
    }
    if (context.current?.state === "running") void context.current.suspend().catch(() => {});
    setPhase("off");
  }, []);

  const finish = useCallback(async (capture: Capture) => {
    releaseMicrophone(capture);
    closeAudio(capture);
    if (active.current !== capture) return;
    if (capture.voiced < minVoiceSamples) {
      stop();
      setSpeechError(capture.samples < voiceSampleRate * 0.4 ? holdToTalk : noSpeech);
      return;
    }
    setPhase("finishing");
    let text = "";
    try {
      let timer: number | undefined;
      const grace = new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error("Streaming transcription stalled")), streamGraceMs);
      });
      try {
        text = await Promise.race([capture.transcript!, grace]);
      } catch {
        if (active.current !== capture) return;
        text = await transcribeClip(capture);
      } finally {
        window.clearTimeout(timer);
      }
      if (active.current !== capture) return;
      text = text.trim().slice(0, 300);
      if (text) listener.current([text], true);
      else setSpeechError(noSpeech);
    } catch {
      if (active.current === capture) setSpeechError(failed);
    } finally {
      if (active.current === capture) stop();
    }
  }, [stop]);

  const release = useCallback(() => {
    const capture = active.current;
    if (!capture || capture.released) return;
    capture.released = true;
    // A release while the mic is still opening finishes once it opens.
    if (capture.worklet) void finish(capture);
  }, [finish]);

  const press = useCallback(async () => {
    if (!enabled || !promptId || active.current) return;
    const capture: Capture = { controller: new AbortController(), frames: [], samples: 0, voiced: 0, released: false };
    active.current = capture;
    setSpeechError("");
    setPhase("opening");
    prepare();
    const audioContext = context.current;
    // Resume inside the press so browsers that need a gesture allow audio.
    const resume = audioContext?.resume();
    void resume?.catch(() => {});

    // Open the Gateway stream right away. Frames queue in the stream until the socket is open.
    const audio = new ReadableStream<Uint8Array>({ start: (controller) => { capture.audio = controller; } });
    capture.transcript = (async () => {
      const { token, baseURL } = await takeTicket();
      if (active.current === capture) prepare();
      const result = streamTranscribe({
        model: createGateway({ apiKey: token, baseURL }).transcription(voiceModel),
        audio, inputAudioFormat: { type: "audio/pcm", rate: voiceSampleRate },
        providerOptions: voiceProviderOptions, abortSignal: capture.controller.signal,
      });
      let settled = "";
      let partial = "";
      for await (const part of result.fullStream) {
        if (part.type === "error") throw part.error;
        if (part.type === "transcript-delta") partial += part.delta;
        else if (part.type === "transcript-partial") partial = part.text;
        else if (part.type === "transcript-final") {
          settled = [settled, part.text.trim()].filter(Boolean).join(" ");
          partial = "";
        } else continue;
        const interim = [settled, partial.trim()].filter(Boolean).join(" ").slice(0, 300);
        if (interim && active.current === capture && !capture.released) listener.current([interim], false);
      }
      return await result.text;
    })();
    capture.transcript.catch(() => {});

    try {
      if (!audioContext) throw new Error("Web Audio is unavailable");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (active.current !== capture) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      capture.stream = stream;
      await Promise.all([resume, worklet.current]);
      if (active.current !== capture) return;
      const node = new AudioWorkletNode(audioContext, "ozar-voice-capture", { channelCount: 1, channelCountMode: "explicit" });
      capture.worklet = node;
      node.port.onmessage = ({ data: frame }: MessageEvent<Float32Array>) => {
        if (active.current !== capture || !capture.worklet) return;
        let energy = 0;
        for (const sample of frame) energy += sample * sample;
        capture.frames.push(frame);
        capture.samples += frame.length;
        if (energy / frame.length > 0.000225) capture.voiced += frame.length;
        try { capture.audio?.enqueue(encodePcm16(frame)); } catch { /* The stream failed. The fallback still has the clip. */ }
      };
      capture.source = audioContext.createMediaStreamSource(stream);
      // The worklet posts PCM to its port. Its audio output is silent.
      capture.source.connect(node).connect(audioContext.destination);
      capture.timer = window.setTimeout(release, maxVoiceSeconds * 1000);
      setUsed(true);
      setPhase("listening");
      if (capture.released) void finish(capture);
    } catch {
      if (active.current !== capture) return;
      stop();
      setSpeechError("המיקרופון אינו זמין כרגע. אפשר להקליד תשובה.");
    }
  }, [enabled, promptId, prepare, takeTicket, finish, release, stop]);

  useEffect(() => {
    if (enabled) prepare();
    const pauseIfHidden = () => { if (document.hidden) stop(); };
    if (enabled) document.addEventListener("visibilitychange", pauseIfHidden);
    return () => {
      document.removeEventListener("visibilitychange", pauseIfHidden);
      stop();
    };
  }, [enabled, promptId, prepare, stop]);

  useEffect(() => () => {
    void context.current?.close().catch(() => {});
    context.current = null;
    worklet.current = null;
  }, []);

  const currentPhase = enabled ? phase : "off";
  return {
    listening: currentPhase === "listening",
    recording: currentPhase === "opening" || currentPhase === "listening",
    finishing: currentPhase === "finishing",
    micStatus: !enabled ? "המיקרופון כבוי" : currentPhase === "opening" ? "פותח מיקרופון…" :
      currentPhase === "listening" ? "מקשיב · שחררו לסיום" : currentPhase === "finishing" ? "מסיים זיהוי…" : "החזיקו כדי לדבר",
    speechError,
    press,
    release,
    stop,
    showTranscriptionNotice: !used,
  };
}
