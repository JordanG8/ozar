import type { AnswerInput } from "./protocol";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
export const isUuid = (value: unknown): value is string => typeof value === "string" && uuid.test(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 300;
export const invalid = () => Response.json({ error: "invalid" }, { status: 400 });

export function parseAnswer(input: unknown): AnswerInput | undefined {
  if (!input || typeof input !== "object" || !("kind" in input)) return;
  if (input.kind === "continue" || input.kind === "skip") return { kind: input.kind };
  if (input.kind === "tap" && "choice" in input && isUuid(input.choice)) return { kind: input.kind, choice: input.choice };
  if (input.kind === "typed" && "value" in input && isText(input.value)) return { kind: input.kind, value: input.value.trim() };
  if (input.kind === "voice" && "alternatives" in input && "final" in input &&
      Array.isArray(input.alternatives) && input.alternatives.length > 0 &&
      input.alternatives.length <= 5 && input.alternatives.every(isText) && typeof input.final === "boolean") {
    return { kind: input.kind, alternatives: input.alternatives.map((value) => value.trim()), final: input.final };
  }
}
