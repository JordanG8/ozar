import { describe, expect, it } from "vitest";
import { nextStage, rateAnswer, selectQueued, type LearningStage } from "./queue";

describe("Learn queue", () => {
  it("places seven to ten intervening cards before the first test or a retry", () => {
    expect(nextStage("intro", false, 2, () => 0)).toEqual({ nextStage: "voice_meaning", eligiblePosition: 10 });
    expect(nextStage("reverse_choice", false, 30, () => .999)).toEqual({ nextStage: "voice_meaning", eligiblePosition: 41 });
    expect(nextStage("voice_meaning", false, 30, () => 0)?.nextStage).toBe("voice_meaning");
  });

  it("places fifteen to twenty intervening cards before reverse choice and graduates on success", () => {
    expect(nextStage("voice_meaning", true, 10, () => 0)).toEqual({ nextStage: "reverse_choice", eligiblePosition: 26 });
    expect(nextStage("voice_meaning", true, 10, () => .999)?.eligiblePosition).toBe(31);
    expect(nextStage("reverse_choice", true, 26)).toBeNull();
  });

  it("orders new words by book position and tests eligible reviews first", () => {
    const rows: { nextStage: LearningStage; eligiblePosition: number; position: number }[] = [
      { nextStage: "intro", eligiblePosition: 1, position: 10 },
      { nextStage: "intro", eligiblePosition: 1, position: 9 },
      { nextStage: "voice_meaning", eligiblePosition: 9, position: 1 },
    ];
    expect(selectQueued(rows, 8)?.position).toBe(9);
    expect(selectQueued(rows, 9)?.position).toBe(1);
    expect(selectQueued([rows[2]], 8)?.position).toBe(1);
  });

  it("rates successes against a median and caps hints at Hard", () => {
    const history = [4000, 5500, 1200, 6000, 5000];
    expect(rateAnswer(true, 0, 1000, history)).toBe("easy");
    expect(rateAnswer(true, 1, 1000, history)).toBe("hard");
    expect(rateAnswer(true, 0, 5500, history)).toBe("good");
    expect(rateAnswer(true, 0, 7000, history)).toBe("hard");
    expect(rateAnswer(false, 2, 1000, history)).toBe("again");
  });
});
