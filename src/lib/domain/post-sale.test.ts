import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isCalendarDay, nextPostSaleState, saoPauloDay } from "./post-sale";

describe("pós-venda", () => {
  it("calculates seven calendar days across month, year and leap-day boundaries", () => {
    expect(nextPostSaleState("issuing", null, { stage: "onboarding", day: "2026-12-28" })).toEqual({
      stage: "onboarding",
      dueOn: "2027-01-04",
      effectiveOn: "2026-12-28",
    });
    expect(
      nextPostSaleState("pending", null, { stage: "onboarding", day: "2028-02-25" }).dueOn,
    ).toBe("2028-03-03");
    expect(isCalendarDay("2026-02-29")).toBe(false);
    expect(isCalendarDay("2028-02-29")).toBe(true);
  });

  it("starts with confirmed internal data and no WhatsApp context", () => {
    expect(nextPostSaleState(null, null, { stage: "issuing", day: "2026-11-14" })).toEqual({
      stage: "issuing",
      dueOn: "2026-11-14",
      effectiveOn: null,
    });
  });

  it("requires a real date and a description for a pending case", () => {
    expect(() =>
      nextPostSaleState(null, null, { stage: "pending", day: "2026-11-14", note: "  " }),
    ).toThrow("pendência");
    expect(() =>
      nextPostSaleState("issuing", null, { stage: "onboarding", day: "2026-11-31" }),
    ).toThrow("data válida");
  });

  it("concludes after confirmed coverage and removes the open deadline", () => {
    expect(() => nextPostSaleState("issuing", null, { stage: "done" })).toThrow();
    expect(nextPostSaleState("onboarding", "2026-11-14", { stage: "done" })).toEqual({
      stage: "done",
      dueOn: null,
      effectiveOn: "2026-11-14",
    });
    expect(() =>
      nextPostSaleState("done", "2026-11-14", { stage: "issuing", day: "2026-11-14" }),
    ).toThrow();
  });

  it("uses São Paulo's calendar day for deadlines", () => {
    expect(saoPauloDay(new Date("2026-11-12T02:59:59Z"))).toBe("2026-11-11");
    expect(saoPauloDay(new Date("2026-11-12T03:00:00Z"))).toBe("2026-11-12");
  });

  it("applies the migration to existing rows and rejects inconsistent and concurrent changes", async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        CREATE TABLE opportunities(id integer PRIMARY KEY, user_id integer, status text);
        INSERT INTO opportunities VALUES (1, 10, 'won'), (2, 20, 'won');
      `);
      await db.exec(readFileSync("drizzle/migrations/0008_post_sale.sql", "utf8"));
      expect(
        (await db.query("SELECT post_sale_stage, post_sale_version FROM opportunities WHERE id=1"))
          .rows,
      ).toEqual([{ post_sale_stage: null, post_sale_version: 0 }]);
      await expect(
        db.exec(
          "UPDATE opportunities SET post_sale_stage='onboarding', post_sale_version=1, post_sale_effective_on='2026-11-14', post_sale_due_on='2026-11-15' WHERE id=1",
        ),
      ).rejects.toThrow("opportunities_post_sale_state_check");
      await expect(
        db.exec(
          "UPDATE opportunities SET post_sale_stage='pending', post_sale_version=1, post_sale_due_on='2026-11-15' WHERE id=1",
        ),
      ).rejects.toThrow("opportunities_post_sale_pending_note_check");

      const save = (user: number) =>
        db.query(
          "UPDATE opportunities SET post_sale_stage='issuing', post_sale_due_on='2026-11-15', post_sale_version=1 WHERE id=1 AND user_id=$1 AND status='won' AND post_sale_version=0 RETURNING id",
          [user],
        );
      expect((await save(20)).rows).toEqual([]);
      expect((await save(10)).rows).toEqual([{ id: 1 }]);
      expect((await save(10)).rows).toEqual([]);
    } finally {
      await db.close();
    }
  });
});
