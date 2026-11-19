export const judgeModel = "google/gemini-decision-1";
export const judgeTimeoutMs = 3000;

export type JudgeOutput = {
  choice: "correct" | "partial" | "wrong";
  probabilities?: Record<string, number>;
};

export type JudgeAttempt = {
  model: string;
  input: "voice" | "typed";
  text: string;
  receivedAt: number;
  deadline: number;
  failure?: "timeout" | "unavailable";
  latencyMs?: number;
};

export type JudgeLog = {
  model: string;
  input: string;
  output: JudgeOutput | null;
  latencyMs: number;
  status: "decided" | "cached" | "timeout" | "unavailable";
  cacheKey: string;
  selfGrade?: boolean;
};
