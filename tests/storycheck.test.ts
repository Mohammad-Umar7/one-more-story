import { describe, expect, it } from "vitest";
import { baselineMessage, compareWithBaseline, summarizeCheck } from "../src/lib/shared/storycheck";

describe("story game starting point", () => {
  it("summarises what was remembered", () => {
    expect(summarizeCheck({ correct: 3, total: 4 })).toBe("Remembered 3 of 4 things about the photo, and needed a little help with 1.");
    expect(summarizeCheck({ correct: 4, total: 4 })).toBe("Remembered 4 of 4 things about the photo, with no help needed.");
  });
  it("compares later games with the starting point", () => {
    expect(compareWithBaseline({ correct: 3, total: 4 }, { correct: 3, total: 4 }).verdict).toBe("same");
    expect(compareWithBaseline({ correct: 3, total: 4 }, { correct: 4, total: 4 }).verdict).toBe("more");
    expect(compareWithBaseline({ correct: 3, total: 4 }, { correct: 2, total: 4 }).verdict).toBe("fewer");
    const much = compareWithBaseline({ correct: 3, total: 4 }, { correct: 1, total: 4 });
    expect(much.verdict).toBe("much_fewer");
    expect(much.sentence).toBe("Remembered 1 of 4: 2 fewer than the starting point (3 of 4). Needed more help than usual.");
  });
  it("tells the family once the starting point is set", () => {
    const m = baselineMessage("Dada", { correct: 3, total: 4 });
    expect(m.title).toBe("Dada's starting point is set");
    expect(m.body).toContain("remembered 3 of 4 things");
  });
});
