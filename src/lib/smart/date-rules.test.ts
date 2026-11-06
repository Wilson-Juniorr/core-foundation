import { describe, expect, it } from "vitest";
import { extractCommitments } from "./rules";

// Quinta-feira, 12/03/2026, 11h em São Paulo.
const thursday = new Date("2026-03-12T14:00:00Z");
const read = (text: string) => extractCommitments({ text, direction: "inbound", now: thursday });

describe("post-quote date rules", () => {
  it("'me chama sexta' without a time uses 15h", () => {
    const [item] = read("me chama sexta");
    expect(item?.due_at).toBe("2026-03-13T18:00:00.000Z");
  });
  it("'te respondo até sexta' waits for the deadline and returns next allowed day at 15h", () => {
    const [item] = read("te respondo até sexta");
    expect(item?.commitment_type).toBe("customer_deadline");
    expect(item?.due_at).toBe("2026-03-16T18:00:00.000Z"); // segunda 15h
  });
  it("'vou conversar com minha esposa' on Thursday returns Monday 15h", () => {
    const items = read("vou conversar com minha esposa");
    expect(items).toHaveLength(1);
    expect(items[0]?.due_window_end).toBe("2026-03-16T18:00:00.000Z");
  });
  it("explicit deadline overrides the spouse default wait", () => {
    const items = read("vou conversar com minha esposa, me chama sexta");
    const dates = items.map((i) => i.due_at ?? i.due_window_end).filter(Boolean);
    expect(dates).toEqual(["2026-03-13T18:00:00.000Z"]);
  });
  it("impossible date becomes a visible review barrier, not an empty list", () => {
    const [item] = read("me chama dia 31/02");
    expect(item?.commitment_type).toBe("date_review");
    expect(item?.responsible).toBe("human");
    expect(item?.due_at).toBeNull();
  });
  it("invalid hour becomes a review barrier", () => {
    expect(read("me chama amanhã às 27h")[0]?.commitment_type).toBe("date_review");
  });
  it("callback request with no recognizable date asks for review", () => {
    expect(read("me chama depois")[0]?.commitment_type).toBe("date_review");
  });
});
