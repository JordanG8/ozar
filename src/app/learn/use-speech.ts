"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RecognitionResult = { isFinal: boolean; length: number; [index: number]: { transcript: string } };
interface Recognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  abort(): void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

export function useSpeech(
  promptId: string | null,
  enabled: boolean,
  onSpeech: (alternatives: string[], final: boolean) => void,
) {
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const instance = useRef<Recognition | null>(null);
  const restarts = useRef(0);
  const retry = useRef<number | undefined>(undefined);
  const listener = useRef(onSpeech);

  useEffect(() => {
    listener.current = onSpeech;
  }, [onSpeech]);

  const stop = useCallback(() => {
    window.clearTimeout(retry.current);
    const recognition = instance.current;
    instance.current = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onstart = null;
      recognition.onerror = null;
      recognition.onend = null;
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
    let heardFinal = false;
    let retryable = true;
    recognition.onstart = () => setListening(true);
    recognition.onresult = ({ results, resultIndex }) => {
      const result = results[resultIndex];
      if (!result) return;
      const alternatives = Array.from(result, ({ transcript }) => transcript.trim().slice(0, 300)).filter(Boolean);
      if (!alternatives.length) return;
      heardFinal ||= result.isFinal;
      listener.current(alternatives, result.isFinal);
    };
    recognition.onerror = ({ error }) => {
      if (error === "aborted" || error === "no-speech") return;
      retryable = false;
      setSpeechError("זיהוי הדיבור אינו זמין כרגע. אפשר להקליד תשובה.");
    };
    recognition.onend = () => {
      if (instance.current !== recognition) return;
      instance.current = null;
      setListening(false);
      if (!heardFinal && retryable && restarts.current < 3) {
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

  useEffect(() => {
    restarts.current = 0;
    // Schedule the first attempt so discarded Strict Mode renders never open the mic.
    const first = enabled ? window.setTimeout(start, 0) : undefined;
    return () => {
      window.clearTimeout(first);
      stop();
    };
  }, [enabled, promptId, start, stop]);

  return { listening, speechError, start, stop };
}
