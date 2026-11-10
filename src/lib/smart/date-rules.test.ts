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
  it.each(["me chama dia 32", "me chama dia 0", "me chama às 14h"])(
    "%s blocks sending until human date review",
    (text) => {
      expect(read(text)).toEqual([
        expect.objectContaining({
          commitment_type: "date_review",
          responsible: "human",
          due_at: null,
          due_window_end: null,
          is_ambiguous: true,
        }),
      ]);
    },
  );
  it.each(["me chama quinta dia 13/03/2026 às 14h25", "me chama sexta dia 12 às 14:25"])(
    "%s rejects a weekday that contradicts the calendar date",
    (text) => {
      const items = read(text);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        commitment_type: "date_review",
        responsible: "human",
        due_at: null,
      });
    },
  );
  it.each(["me chama sexta dia 13/03/2026 às 14h25", "me chama sexta dia 13 às 14:25"])(
    "%s creates exactly one commitment with the stated hour and minutes",
    (text) => {
      const items = read(text);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        commitment_type: "requested_callback",
        due_at: "2026-03-13T17:25:00.000Z",
        is_ambiguous: false,
      });
    },
  );
  it("a month rollover preserves the explicit time and validates the resulting date", () => {
    expect(read("me chama dia 5 às 14h25")[0]?.due_at).toBe("2026-04-06T17:25:00.000Z");
    expect(read("me chama dia 31")[0]?.due_at).toBe("2026-03-31T13:00:00.000Z");
  });
  it.each([
    ["me chama sexta, dia 13, à tarde", "2026-03-13T18:00:00.000Z"], // sexta 15h
    ["me chama sexta, dia 13, de manhã", "2026-03-13T12:00:00.000Z"], // sexta 9h
    ["me chama sexta, dia 13, à noite", "2026-03-13T22:00:00.000Z"], // sexta 19h
  ])("%s becomes one commitment at the period's hour", (text, expected) => {
    const items = read(text);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      commitment_type: "requested_callback",
      due_at: expected,
      is_ambiguous: false,
    });
  });
  it("an explicit time beats the period of the day on a stated date", () => {
    const items = read("me chama sexta, dia 13, à tarde, às 14h25");
    expect(items).toHaveLength(1);
    expect(items[0]?.due_at).toBe("2026-03-13T17:25:00.000Z");
  });
  it("period of the day also applies to weekday and tomorrow references", () => {
    expect(read("me chama sexta à tarde")[0]?.due_at).toBe("2026-03-13T18:00:00.000Z");
    expect(read("me chama amanhã de manhã")[0]?.due_at).toBe("2026-03-13T12:00:00.000Z");
  });
});
