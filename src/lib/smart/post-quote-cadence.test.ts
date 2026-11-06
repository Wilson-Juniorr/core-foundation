import { describe, expect, it } from "vitest";
import { firstContactAt, localInstant, nextSilenceContact } from "./post-quote-cadence";

const tz = "America/Sao_Paulo";
const fmt = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
// Semana sem feriado: seg 09/03/2026 a sex 13/03/2026.
const at = (d: number, h: number, m = 0) => localInstant(2026, 3, d, h, m, tz);

describe("primeiro contato pós-cotação (24h + 10h)", () => {
  it.each([
    [at(9, 9), at(10, 10)],
    [at(9, 10), at(10, 10)],
    [at(9, 10, 1), at(11, 10)],
    [at(9, 16), at(11, 10)],
    [at(9, 21), at(11, 10)],
    [at(13, 9), at(16, 10)],
  ])("%s → %s", (activated, expected) => {
    expect(fmt(firstContactAt(activated, tz))).toBe(fmt(expected));
  });

  it("pula feriado nacional (20/11/2026, sexta)", () => {
    const r = firstContactAt(localInstant(2026, 11, 19, 9, 0, tz), tz);
    expect(fmt(r)).toBe(fmt(localInstant(2026, 11, 23, 10, 0, tz)));
  });
});

describe("cadência de silêncio", () => {
  it("8 contatos com dias e horários corretos, sem 9º", () => {
    const activated = at(9, 9);
    let last: Date | null = null;
    const got: string[] = [];
    for (let done = 0; done < 8; done += 1) {
      const n = nextSilenceContact({
        doneContacts: done,
        activatedAt: activated,
        lastContactAt: last,
        timezone: tz,
      });
      expect(n).not.toBeNull();
      if (!n) throw new Error("Missing cadence step");
      got.push(fmt(n.at));
      last = n.at;
    }
    // 10/03 10h; +3=13 15h; +3=16 10h; +4=20 15h; +5=25 10h; +5=30 15h; +7=06/04 15h; +7=13/04 15h
    expect(got).toEqual(
      [
        localInstant(2026, 3, 10, 10, 0, tz),
        localInstant(2026, 3, 13, 15, 0, tz),
        localInstant(2026, 3, 16, 10, 0, tz),
        localInstant(2026, 3, 20, 15, 0, tz),
        localInstant(2026, 3, 25, 10, 0, tz),
        localInstant(2026, 3, 30, 15, 0, tz),
        localInstant(2026, 4, 6, 15, 0, tz),
        localInstant(2026, 4, 13, 15, 0, tz),
      ].map(fmt),
    );
    expect(
      nextSilenceContact({
        doneContacts: 8,
        activatedAt: activated,
        lastContactAt: last,
        timezone: tz,
      }),
    ).toBeNull();
  });

  it("soma dias de calendário e só depois ajusta ao dia útil", () => {
    // último contato quinta 12/03 → +3 = domingo 15 → segunda 16 às 15h
    const n = nextSilenceContact({
      doneContacts: 1,
      activatedAt: at(9, 9),
      lastContactAt: at(12, 10),
      timezone: tz,
    });
    if (!n) throw new Error("Missing cadence step");
    expect(fmt(n.at)).toBe(fmt(at(16, 15)));
  });
});
