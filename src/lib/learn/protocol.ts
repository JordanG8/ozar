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
};

export type Feedback = {
  correct: boolean;
  matched: string | null;
  term: string;
  definition: string;
  example: string | null;
};

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
};

export type AnswerInput =
  | { kind: "continue" }
  | { kind: "tap"; choice: string }
  | { kind: "typed"; value: string }
  | { kind: "voice"; alternatives: string[]; final: boolean }
  | { kind: "skip" };
