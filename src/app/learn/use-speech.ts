"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onspeechend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

export function useSpeech(
  promptId: string | null,
  enabled: boolean,
  onSpeech: (alternatives: string[], ended: boolean) => void,
) {
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const instance = useRef<Recognition | null>(null);
  const restarts = useRef(0);
  const retry = useRef<number | undefined>(undefined);
  const boundary = useRef<number | undefined>(undefined);
  const listener = useRef(onSpeech);

  useEffect(() => {
    listener.current = onSpeech;
  }, [onSpeech]);

  const stop = useCallback(() => {
    window.clearTimeout(retry.current);
    window.clearTimeout(boundary.current);
    const recognition = instance.current;
    instance.current = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onstart = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.onspeechend = null;
      recognition.abort();
    }
    setListening(false);
  }, []);

  const start = useCallback(function listen() {
    if (instance.current) return;
    window.clearTimeout(retry.current);
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
    let retryable = true;
    function submitUtterance() {
      if (submitted || !latest.length) return;
      submitted = true;
      listener.current(latest, true);
    }
    recognition.onstart = () => setListening(true);
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
      if (error === "aborted" || error === "no-speech") return;
      retryable = false;
      setSpeechError("זיהוי הדיבור אינו זמין כרגע. אפשר להקליד תשובה.");
    };
    recognition.onend = () => {
      if (instance.current !== recognition) return;
      window.clearTimeout(boundary.current);
      instance.current = null;
      setListening(false);
      if (retryable) submitUtterance();
      if (!submitted && retryable && restarts.current < 3) {
        restarts.current++;
        retry.current = window.setTimeout(listen, 400);
      }
    };
    try {
      recognition.start();
      setSpeechError("");
    } catch {
      instance.current = null;
      setSpeechError("המיקרופון אינו זמין כרגע. אפשר להקליד תשובה.");
    }
  }, []);

  const finish = useCallback(() => {
    if (instance.current) instance.current.stop();
  }, []);

  useEffect(() => {
    restarts.current = 0;
    // Schedule the first attempt so discarded Strict Mode renders never open the mic.
    const first = enabled ? window.setTimeout(start, 0) : undefined;
    return () => {
      window.clearTimeout(first);
      stop();
    };
  }, [enabled, promptId, start, stop]);

  return { listening, speechError, start, stop, finish };
}
