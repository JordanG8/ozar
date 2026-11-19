export type StudyPrompt =
  | { kind: "intro"; id: string; term: string; definition: string; example: string | null }
  | { kind: "voice_meaning"; id: string; term: string }
  | { kind: "reverse_choice"; id: string; definition: string; choices: { id: string; term: string }[] };

export type StudyState = {
  prompt: StudyPrompt | null;
  remaining: number;
  total: number;
  inputDefault: "voice" | "typed";
  hintLevel: number;
  judgePending?: "checking" | "self_grade";
};

export type Feedback = {
  correct: boolean;
  matched: string | null;
  term: string;
  definition: string;
  example: string | null;
  decision?: JudgeVerdict;
};

export type JudgeVerdict = "correct" | "partial" | "wrong";
export type MeaningInput = Extract<AnswerInput, { kind: "typed" | "voice" }>;
export type AnswerReceipt = {
  accepted: boolean;
  feedback: Feedback | null;
  judgePending?: "checking" | "self_grade";
  responseMs?: number;
};

export function decisionNudge(verdict: JudgeVerdict) {
  if (verdict === "partial") return "הכיוון נכון. כדאי לבדוק איזה פרט חסר בתשובה.";
  if (verdict === "wrong") return "התשובה לא התאימה למשמעות שבכרטיס. כדאי לשים לב להבדל.";
  return null;
}

export type InfiniteState = {
  prompt: Exclude<StudyPrompt, { kind: "intro" }> | null;
  inputDefault: "voice" | "typed";
  startedAt: string;
  answers: number;
  correct: number;
  averageMs: number;
  combo: number;
  best: number;
  today: number;
  goal: number;
  streak: number;
  judgePending?: "checking" | "self_grade";
};

export type AnswerInput =
  | { kind: "continue" }
  | { kind: "tap"; choice: string }
  | { kind: "typed"; value: string }
  | { kind: "voice"; alternatives: string[]; final: boolean }
  | { kind: "skip" };
