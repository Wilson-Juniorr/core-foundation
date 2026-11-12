import { describe, expect, it } from "vitest";
import { extractionIsWeak, parseContactFromText } from "./ocr-parse";

describe("cadastro por print", () => {
  it("não preenche o nome com uma saudação da conversa", () => {
    const result = parseContactFromText("Bom Dia Tudo Bem\n(11) 91234-0003");
    expect(result.name).toBe("");
    expect(result.phone).toBe("+5511912340003");
    expect(extractionIsWeak(result)).toBe(true);
  });

  it("preserva dois telefones como opções e não escolhe um deles", () => {
    const result = parseContactFromText(
      "Nome: Marina Exemplo\nTelefone: (11) 91234-0001\nCelular: (11) 91234-0002",
    );
    expect(result.phone).toBe("");
    expect(result.phoneOptions).toEqual(["+5511912340001", "+5511912340002"]);
  });

  it("ignora documentos e mantém o contexto sem repetir linhas de duas leituras", () => {
    const text = "Nome: Marina Exemplo\nCPF: 119.123.456-78\nPlano familiar em Guarulhos";
    const result = parseContactFromText(`${text}\n${text}`);
    expect(result.phoneOptions).toEqual([]);
    expect(result.name).toBe("Marina Exemplo");
    expect(result.notes).toBe("Plano familiar em Guarulhos");
  });
});
