"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { judgeTimeoutMs } from "@/lib/learn/judge-config";
import type { AnswerReceipt, MeaningInput } from "@/lib/learn/protocol";
import { request } from "./request";

type Pending = AnswerReceipt["judgePending"];
type Submission = MeaningInput | { kind: "self"; correct: boolean };
type Attempt = { promptId: string; selfSending: boolean };

export function useJudge(mode: "learn" | "infinite") {
  const [pending, setPending] = useState<Pending>();
  const [selfBusy, setSelfBusy] = useState(false);
  const active = useRef<Attempt | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const reset = useCallback((promptId?: string, status?: Pending) => {
    window.clearTimeout(timer.current);
    active.current = promptId && status ? { promptId, selfSending: false } : null;
    setPending(status);
    setSelfBusy(false);
    if (status === "checking") {
      timer.current = window.setTimeout(() => setPending("self_grade"), judgeTimeoutMs);
    }
  }, []);

  useEffect(() => () => {
    window.clearTimeout(timer.current);
    active.current = null;
  }, []);

  async function submit(promptId: string, input: Submission) {
    const self = input.kind === "self";
    if (!self) {
      if (active.current?.promptId === promptId) return null;
      reset(promptId, "checking");
    }
    const attempt = active.current;
    if (!attempt || attempt.promptId !== promptId || (self && attempt.selfSending)) return null;
    if (self) {
      attempt.selfSending = true;
      setSelfBusy(true);
    }
    try {
      const receipt = await request<AnswerReceipt>({ mode, promptId, input }, "/api/judge");
      if (active.current !== attempt) return null;
      if (receipt.feedback) reset();
      else if (receipt.judgePending === "self_grade") {
        window.clearTimeout(timer.current);
        setPending("self_grade");
      } else if (!receipt.judgePending) reset();
      return receipt;
    } catch (cause) {
      if (active.current !== attempt) return null;
      if (!self) reset();
      throw cause;
    } finally {
      if (self && active.current === attempt) {
        attempt.selfSending = false;
        setSelfBusy(false);
      }
    }
  }

  return { pending, selfBusy, reset, submit };
}
