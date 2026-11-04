import { describe, expect, it } from "vitest";
import { isBusinessDay, parseRelativeDays, toBusinessDay } from "./business-calendar";
import { extractCommitments } from "./rules";

const sp = (iso: string) => new Date(`${iso}-03:00`);
const localDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

describe("calendário comercial", () => {
  it("quinta + 'me chama daqui 3 dias' cai na segunda", () => {
    const [c] = extractCommitments({ text: "me chama daqui 3 dias", direction: "inbound", now: sp("2026-11-05T10:00:00") });
    expect(localDate(new Date(c.due_at!))).toBe("2026-11-09");
  });
  it("feriado nacional não é dia útil (20/11/2026, sexta)", () => {
    expect(isBusinessDay(sp("2026-11-20T10:00:00"))).toBe(false);
    expect(localDate(toBusinessDay(sp("2026-11-20T10:00:00")))).toBe("2026-11-23");
  });
  it("Sexta-feira Santa 2026 (03/04) é feriado", () => {
    expect(isBusinessDay(sp("2026-04-03T10:00:00"))).toBe(false);
  });
  it("lê números por extenso e semanas", () => {
    expect(parseRelativeDays("daqui a dois dias")).toBe(2);
    expect(parseRelativeDays("em 2 semanas te falo")).toBe(14);
    expect(parseRelativeDays("ok obrigado")).toBeNull();
  });
});
