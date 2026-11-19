"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQuietSpeech } from "./use-quiet-speech";

type RecognitionResult = { isFinal: boolean; length: number; [index: number]: { transcript: string } };
interface Recognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onaudiostart: (() => void) | null;
  onaudioend: (() => void) | null;
  onend: (() => void) | null;
  onspeechend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

function useBrowserSpeech(
  promptId: string | null,
  enabled: boolean,
  onSpeech: (alternatives: string[], ended: boolean) => void,
) {
  const [phase, setPhase] = useState<"off" | "opening" | "listening" | "finishing">("off");
  const [speechError, setSpeechError] = useState("");
  const instance = useRef<Recognition | null>(null);
  const attemptedPrompt = useRef<string | null>(null);
  const boundary = useRef<number | undefined>(undefined);
  const listener = useRef(onSpeech);

  useEffect(() => {
    listener.current = onSpeech;
  }, [onSpeech]);

  const stop = useCallback(() => {
    window.clearTimeout(boundary.current);
    const recognition = instance.current;
    instance.current = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onaudiostart = null;
      recognition.onaudioend = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.onspeechend = null;
      recognition.abort();
    }
    setPhase("off");
  }, []);

  const start = useCallback(() => {
    if (!enabled || !promptId || instance.current) return;
    attemptedPrompt.current = promptId;
    const speechWindow = window as SpeechWindow;
    const BrowserRecognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!BrowserRecognition) {
      setSpeechError("הדפדפן הזה אינו תומך בזיהוי דיבור. אפשר להקליד תשובה.");
      return;
    }
    const recognition = new BrowserRecognition();
    instance.current = recognition;
    recognition.lang = "he-IL";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 5;
    let latest: string[] = [];
    let submitted = false;
    let canSubmit = true;
    function submitUtterance() {
      if (!canSubmit || submitted || !latest.length) return;
      submitted = true;
      listener.current(latest, true);
    }
    recognition.onaudiostart = () => setPhase("listening");
    recognition.onaudioend = () => setPhase("finishing");
    recognition.onresult = ({ results, resultIndex }) => {
      const result = results[resultIndex];
      if (!result || submitted) return;
      const previous = Array.from({ length: resultIndex }, (_, index) => results[index]?.[0]?.transcript ?? "").join(" ").trim();
      const alternatives = Array.from(result, ({ transcript }) =>
        [previous, transcript.trim()].filter(Boolean).join(" ").slice(0, 300)).filter(Boolean);
      if (!alternatives.length) return;
      latest = alternatives;
      listener.current(alternatives, false);
    };
    recognition.onspeechend = () => {
      // Give the recognizer a brief chance to revise the last interim result.
      window.clearTimeout(boundary.current);
      boundary.current = window.setTimeout(submitUtterance, 140);
    };
    recognition.onerror = ({ error }) => {
      if (error === "aborted") return;
      canSubmit = false;
      setPhase("off");
      setSpeechError(error === "no-speech" ? "לא נקלט דיבור. אפשר להפעיל שוב את המיקרופון."
        : "זיהוי הדיבור אינו זמין כרגע. אפשר להקליד תשובה.");
    };
    recognition.onend = () => {
      if (instance.current !== recognition) return;
      window.clearTimeout(boundary.current);
      instance.current = null;
      setPhase("off");
      submitUtterance();
      if (canSubmit && !submitted) setSpeechError("לא נקלט דיבור. אפשר להפעיל שוב את המיקרופון.");
    };
    try {
      setSpeechError("");
      setPhase("opening");
      recognition.start();
    } catch {
      instance.current = null;
      setPhase("off");
      setSpeechError("המיקרופון אינו זמין כרגע. אפשר להקליד תשובה.");
    }
  }, [enabled, promptId]);

  const finish = useCallback(() => {
    if (instance.current) instance.current.stop();
  }, []);

  useEffect(() => {
    // Schedule the first attempt so discarded Strict Mode renders never open the mic.
    const first = enabled && attemptedPrompt.current !== promptId ? window.setTimeout(start, 0) : undefined;
    return () => {
      window.clearTimeout(first);
      stop();
    };
  }, [enabled, promptId, start, stop]);

  return { phase, speechError, start, stop, finish };
}

function isAndroid() {
  return /Android/iu.test(navigator.userAgent) ||
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform === "Android";
}

const subscribe = () => () => {};
const serverPlatform = () => null;

export function useSpeech(
  promptId: string | null,
  enabled: boolean,
  onSpeech: (alternatives: string[], ended: boolean) => void,
) {
  const android = useSyncExternalStore(subscribe, isAndroid, serverPlatform);
  const browser = useBrowserSpeech(promptId, enabled && android === false, onSpeech);
  const quiet = useQuietSpeech(promptId, enabled && android === true, (text) => onSpeech([text], true));
  const { phase, ...controls } = android ? quiet : browser;
  const currentPhase = enabled ? phase : "off";
  return {
    listening: currentPhase === "listening",
    recording: currentPhase === "opening" || currentPhase === "listening",
    finishing: currentPhase === "finishing",
    micStatus: currentPhase === "opening" ? "פותח מיקרופון…" :
      currentPhase === "listening" ? "המיקרופון פעיל" : "המיקרופון כבוי",
    ...controls,
    showTranscriptionNotice: android === true && quiet.needsActivation,
  };
}
