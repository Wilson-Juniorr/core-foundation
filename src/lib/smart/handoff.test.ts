import { describe, expect, it } from "vitest";

import {
  alertSendAfter,
  alignToBusinessWindow,
  customerWaitingTooLong,
  decideReturn,
  detectPriceTalk,
  detectTechnicalQuestion,
  isAutomationEcho,
  type ReturnInput,
} from "./handoff";

// Horários em São Paulo (UTC-3). 2026-11-05 é quinta-feira.
const sp = (iso: string) => new Date(`${iso}-03:00`);

function base(overrides: Partial<ReturnInput> = {}): ReturnInput {
  return {
    now: sp("2026-11-05T11:00:00"),
    handoffKind: "manual",
    sensitiveSinceHandoff: false,
    lastInboundAt: sp("2026-11-05T09:00:00"),
    lastHumanAt: sp("2026-11-05T10:00:00"),
    pendingHumanPromise: null,
    instruction: null,
    aiProposal: null,
    ...overrides,
  };
}

describe("decideReturn — travas", () => {
  it("cliente esperando sua resposta: fica com você, mesmo se a IA quiser voltar", () => {
    const result = decideReturn(
      base({
        lastInboundAt: sp("2026-11-05T10:30:00"),
        lastHumanAt: sp("2026-11-05T10:00:00"),
        aiProposal: { mode: "auto", at: sp("2026-11-06T10:00:00"), reason: "sumiu" },
      }),
    );
    expect(result.mode).toBe("hold");
  });

  it("promessa sua em aberto: fica com você", () => {
    const result = decideReturn(
      base({
        pendingHumanPromise: { dueAt: null, description: "enviar a tabela" },
        aiProposal: { mode: "auto", at: null, reason: "x" },
      }),
    );
    expect(result.mode).toBe("hold");
  });

  it("assunto de preço: IA pediu volta direta, vira 'avisa e espera seu ok'", () => {
    const result = decideReturn(
      base({
        handoffKind: "price",
        aiProposal: { mode: "auto", at: sp("2026-11-09T10:00:00"), reason: "ok" },
      }),
    );
    expect(result.mode).toBe("confirm");
  });

  it("assunto sensível marcado durante a conversa também trava a volta direta", () => {
    const result = decideReturn(
      base({ sensitiveSinceHandoff: true, aiProposal: { mode: "auto", at: null, reason: "ok" } }),
    );
    expect(result.mode).toBe("confirm");
  });

  it("assunto simples: a IA pode voltar direto", () => {
    const result = decideReturn(
      base({ aiProposal: { mode: "auto", at: sp("2026-11-09T10:00:00"), reason: "ok" } }),
    );
    expect(result.mode).toBe("auto");
    expect(result.at?.toISOString()).toBe(sp("2026-11-09T10:00:00").toISOString());
  });

  it("nunca volta antes de 24h da sua última mensagem", () => {
    const result = decideReturn(
      base({ aiProposal: { mode: "auto", at: sp("2026-11-05T12:00:00"), reason: "ok" } }),
    );
    expect(result.at!.getTime()).toBeGreaterThanOrEqual(sp("2026-11-06T10:00:00").getTime());
  });

  it("sem análise: espera 2 dias úteis (quinta → segunda às 10h)", () => {
    const result = decideReturn(base());
    expect(result.source).toBe("fallback");
    expect(result.mode).toBe("auto");
    expect(result.at?.toISOString()).toBe(sp("2026-11-09T10:00:00").toISOString());
  });

  it("sem análise e assunto sensível: só com seu ok", () => {
    expect(decideReturn(base({ handoffKind: "closing" })).mode).toBe("confirm");
  });
});

describe("decideReturn — sua instrução sempre vence", () => {
  it("'não fala até eu mandar' segura mesmo com a IA querendo voltar", () => {
    const result = decideReturn(
      base({
        instruction: { mode: "hold", at: null, reason: "Não fala até eu mandar" },
        aiProposal: { mode: "auto", at: null, reason: "x" },
      }),
    );
    expect(result).toMatchObject({ mode: "hold", source: "instruction" });
  });

  it("'pode voltar' vale mesmo em assunto de preço", () => {
    const result = decideReturn(
      base({
        handoffKind: "price",
        instruction: { mode: "auto", at: sp("2026-11-09T10:00:00"), reason: "já resolvi" },
      }),
    );
    expect(result.mode).toBe("auto");
  });

  it("instrução para sábado cai na segunda às 9h", () => {
    const result = decideReturn(
      base({ instruction: { mode: "auto", at: sp("2026-11-07T10:00:00"), reason: "sábado" } }),
    );
    expect(result.at?.toISOString()).toBe(sp("2026-11-09T09:00:00").toISOString());
  });
});

describe("janelas", () => {
  it("sexta às 20h → segunda às 9h", () => {
    expect(alignToBusinessWindow(sp("2026-11-06T20:00:00")).toISOString()).toBe(
      sp("2026-11-09T09:00:00").toISOString(),
    );
  });

  it("feriado de 20/11 (sexta) às 10h → segunda 23/11 às 9h", () => {
    expect(alignToBusinessWindow(sp("2026-11-20T10:00:00")).toISOString()).toBe(
      sp("2026-11-23T09:00:00").toISOString(),
    );
  });

  it("alerta às 22h vai pro resumo das 8h do dia útil seguinte", () => {
    expect(alertSendAfter(sp("2026-11-05T22:00:00")).toISOString()).toBe(
      sp("2026-11-06T08:00:00").toISOString(),
    );
  });

  it("alerta às 15h de quinta sai na hora", () => {
    const now = sp("2026-11-05T15:00:00");
    expect(alertSendAfter(now).toISOString()).toBe(now.toISOString());
  });
});

describe("cliente esperando há 10 minutos", () => {
  const inbound = sp("2026-11-05T15:00:00");

  it("9 minutos: ainda não alerta", () => {
    expect(
      customerWaitingTooLong({
        now: sp("2026-11-05T15:09:00"),
        lastInboundAt: inbound,
        lastOutboundAt: null,
        lastAlertedInboundAt: null,
        thresholdMinutes: 10,
      }),
    ).toBe(false);
  });

  it("10 minutos sem resposta: alerta", () => {
    expect(
      customerWaitingTooLong({
        now: sp("2026-11-05T15:10:00"),
        lastInboundAt: inbound,
        lastOutboundAt: sp("2026-11-05T14:00:00"),
        lastAlertedInboundAt: null,
        thresholdMinutes: 10,
      }),
    ).toBe(true);
  });

  it("você já respondeu: não alerta", () => {
    expect(
      customerWaitingTooLong({
        now: sp("2026-11-05T15:20:00"),
        lastInboundAt: inbound,
        lastOutboundAt: sp("2026-11-05T15:05:00"),
        lastAlertedInboundAt: null,
        thresholdMinutes: 10,
      }),
    ).toBe(false);
  });

  it("um alerta só por resposta do cliente", () => {
    expect(
      customerWaitingTooLong({
        now: sp("2026-11-05T15:30:00"),
        lastInboundAt: inbound,
        lastOutboundAt: null,
        lastAlertedInboundAt: inbound,
        thresholdMinutes: 10,
      }),
    ).toBe(false);
  });
});

describe("detecção de assunto", () => {
  it("preço", () => {
    expect(detectPriceTalk("tá caro, tem desconto?")).toBe(true);
    expect(detectPriceTalk("vou ver com minha esposa")).toBe(false);
  });

  it("técnico", () => {
    expect(detectTechnicalQuestion("qual a carência pra parto?")).toBe(true);
    expect(detectTechnicalQuestion("o hospital Sírio tá na rede credenciada?")).toBe(true);
    expect(detectTechnicalQuestion("me chama semana que vem")).toBe(false);
  });
});

describe("eco do envio automático", () => {
  const at = sp("2026-11-05T15:00:00");

  it("mesmo texto em até 3 minutos é eco, não é você", () => {
    expect(
      isAutomationEcho({ type: "text", text: "Oi Ana, tudo bem?", at }, [
        { type: "text", text: "Oi Ana,  tudo bem?", at: sp("2026-11-05T14:59:30") },
      ]),
    ).toBe(true);
  });

  it("texto diferente é você falando", () => {
    expect(
      isAutomationEcho({ type: "text", text: "Ana, te ligo já", at }, [
        { type: "text", text: "Oi Ana, tudo bem?", at: sp("2026-11-05T14:59:30") },
      ]),
    ).toBe(false);
  });
});
