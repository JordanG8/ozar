"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { encodeVoiceClip, maxVoiceSeconds, minVoiceSamples, voiceSampleRate } from "@/lib/learn/voice-audio";

type Capture = {
  controller: AbortController;
  context?: AudioContext;
  stream?: MediaStream;
  worklet?: AudioWorkletNode;
  timer?: number;
  frames: Float32Array[];
  samples: number;
  voiced: number;
  lastVoice: number;
};

const noSpeech = "לא נקלט דיבור. אפשר להפעיל שוב את המיקרופון.";

function releaseMicrophone(capture: Capture) {
  window.clearTimeout(capture.timer);
  if (capture.worklet) {
    capture.worklet.port.onmessage = null;
    capture.worklet.disconnect();
  }
  capture.stream?.getTracks().forEach((track) => track.stop());
  if (capture.context && capture.context.state !== "closed") void capture.context.close().catch(() => {});
  capture.context = undefined;
  capture.stream = undefined;
  capture.worklet = undefined;
}

export function useQuietSpeech(promptId: string | null, enabled: boolean, onTranscript: (text: string) => void) {
  const [phase, setPhase] = useState<"off" | "opening" | "listening" | "finishing">("off");
  const [speechError, setSpeechError] = useState("");
  const [needsActivation, setNeedsActivation] = useState(true);
  const active = useRef<Capture | null>(null);
  const attemptedPrompt = useRef<string | null>(null);
  const activated = useRef(false);
  const listener = useRef(onTranscript);
  useEffect(() => { listener.current = onTranscript; }, [onTranscript]);

  const stop = useCallback(() => {
    const capture = active.current;
    active.current = null;
    if (capture) {
      capture.controller.abort();
      releaseMicrophone(capture);
    }
    setPhase("off");
  }, []);

  const finish = useCallback(async () => {
    const capture = active.current;
    if (!capture) return;
    if (!capture.worklet) {
      if (!capture.samples) stop();
      return;
    }
    releaseMicrophone(capture);
    if (capture.voiced < minVoiceSamples) {
      stop();
      setSpeechError(noSpeech);
      return;
    }
    setPhase("finishing");
    try {
      const response = await fetch("/api/transcribe", {
        method: "POST", headers: { "Content-Type": "audio/wav" },
        body: encodeVoiceClip(capture.frames, capture.samples),
        signal: AbortSignal.any([capture.controller.signal, AbortSignal.timeout(7000)]),
      });
      if (!response.ok) throw new Error("Transcription request failed");
      const { text }: { text: string } = await response.json();
      if (active.current !== capture) return;
      if (text) listener.current(text);
      else setSpeechError(noSpeech);
    } catch {
      if (active.current === capture) setSpeechError("התמלול לא הצליח. אפשר לנסות שוב או להקליד תשובה.");
    } finally {
      if (active.current === capture) stop();
    }
  }, [stop]);

  const start = useCallback(async () => {
    if (!enabled || !promptId || active.current) return;
    attemptedPrompt.current = promptId;
    const capture: Capture = {
      controller: new AbortController(), frames: [], samples: 0, voiced: 0, lastVoice: 0,
    };
    active.current = capture;
    setSpeechError("");
    setPhase("opening");
    try {
      const context = new AudioContext({ sampleRate: voiceSampleRate });
      capture.context = context;
      const resume = context.resume();
      // Handle a rejected resume while the microphone permission prompt is still open.
      void resume.catch(() => {});
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (active.current !== capture) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      capture.stream = stream;
      await Promise.all([resume, context.audioWorklet.addModule("/voice-capture.js")]);
      if (active.current !== capture) return;
      if (context.sampleRate !== voiceSampleRate) throw new Error("Unexpected microphone sample rate");
      const worklet = new AudioWorkletNode(context, "ozar-voice-capture", { channelCount: 1, channelCountMode: "explicit" });
      capture.worklet = worklet;
      worklet.port.onmessage = ({ data: frame }: MessageEvent<Float32Array>) => {
        if (active.current !== capture || !capture.worklet) return;
        let energy = 0;
        for (const sample of frame) energy += sample * sample;
        capture.frames.push(frame);
        capture.samples += frame.length;
        if (energy / frame.length > 0.000225) {
          capture.voiced += frame.length;
          capture.lastVoice = capture.samples;
        }
        if (capture.voiced >= minVoiceSamples
          ? capture.samples - capture.lastVoice >= voiceSampleRate * 0.6
          : capture.samples >= voiceSampleRate * 5) void finish();
      };
      // The worklet emits PCM to its message port. Its audio output is silent.
      context.createMediaStreamSource(stream).connect(worklet).connect(context.destination);
      capture.timer = window.setTimeout(() => void finish(), maxVoiceSeconds * 1000);
      activated.current = true;
      setNeedsActivation(false);
      setPhase("listening");
    } catch {
      if (active.current !== capture) return;
      stop();
      setSpeechError("המיקרופון אינו זמין כרגע. אפשר להקליד תשובה.");
    }
  }, [enabled, promptId, finish, stop]);

  useEffect(() => {
    const timer = enabled && activated.current && attemptedPrompt.current !== promptId ? window.setTimeout(start, 0) : undefined;
    const pauseIfHidden = () => { if (document.hidden) stop(); };
    if (enabled) document.addEventListener("visibilitychange", pauseIfHidden);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", pauseIfHidden);
      stop();
    };
  }, [enabled, promptId, start, stop]);
  return { phase, speechError, start, stop, finish, needsActivation };
}
