import { describe, expect, it } from "vitest";

import { mergeDealSheet, toDealSheet } from "./deal-sheet";

const base = toDealSheet({
  deal_stage: "quote_sent",
  decision_maker: "Cliente e a esposa",
  quoted_operator: "Amil",
  quoted_value: 389.9,
  temperature: "warm",
});

describe("ficha viva do pós-cotação", () => {
  it("nunca sobrescreve um campo confirmado pelo consultor", () => {
    const incoming = toDealSheet({ ...base, quoted_operator: "Bradesco" });
    const patch = mergeDealSheet(base, incoming, (field) => field === "quoted_operator");
    expect(patch.quoted_operator).toBeUndefined();
  });

  it("leitura vazia da IA não apaga o que já se sabe", () => {
    const incoming = toDealSheet({ deal_stage: "unknown", temperature: "unknown" });
    expect(mergeDealSheet(base, incoming, () => false)).toEqual({});
  });

  it("etapa e temperatura evoluem com a conversa", () => {
    const incoming = toDealSheet({ ...base, deal_stage: "consulting_decider", temperature: "hot" });
    expect(mergeDealSheet(base, incoming, () => false)).toEqual({
      deal_stage: "consulting_decider",
      temperature: "hot",
    });
  });

  it("descarta etapa inválida e valores não positivos", () => {
    const sheet = toDealSheet({ deal_stage: "xyz", quoted_value: "0", quoted_lives: "2,6" });
    expect(sheet.deal_stage).toBe("unknown");
    expect(sheet.quoted_value).toBeNull();
    expect(sheet.quoted_lives).toBe(3);
  });
});
