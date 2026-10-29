import { describe, expect, it } from "vitest";
import { continuesCurrentTouch, countTouches } from "./touches";

const at = (hhmm: string, day = 1) => `2026-10-0${day}T${hhmm}:00.000Z`;

describe("toques do follow-up", () => {
  it("mensagem + continuação 1 minuto depois contam como 1 toque", () => {
    expect(countTouches([at("11:30"), at("11:31")])).toBe(1);
  });

  it("manhã e noite do mesmo dia são 2 toques", () => {
    expect(countTouches([at("11:30"), at("11:31"), at("22:00"), at("22:01")])).toBe(2);
  });

  it("continuação 1 minuto depois do envio do fluxo segue no mesmo toque", () => {
    expect(continuesCurrentTouch([at("11:30")], new Date(at("11:31")))).toBe(true);
  });

  it("depois de 10 minutos já não é continuação", () => {
    expect(continuesCurrentTouch([at("11:30")], new Date(at("11:41")))).toBe(false);
  });

  it("no máximo 3 mensagens seguidas por toque", () => {
    expect(
      continuesCurrentTouch([at("11:30"), at("11:31"), at("11:32")], new Date(at("11:33"))),
    ).toBe(false);
  });
});
