import { describe, expect, it } from "vitest";
import { messageContextText, messageMediaStatus } from "./message-context";

const pdf = {
  message_type: "document",
  media_mime_type: "application/pdf",
  media_filename: "cotacao.pdf",
  text_content: "Segue a cotação",
  metadata: {},
};

describe("contexto de mídia", () => {
  it("preserva a legenda junto ao texto extraído do arquivo", () => {
    const message = {
      ...pdf,
      metadata: { media_context: { status: "ready", text: "Página 1\nPlano para duas vidas." } },
    };
    expect(messageContextText(message)).toContain("Segue a cotação");
    expect(messageContextText(message)).toContain("Página 1\nPlano para duas vidas.");
    expect(messageMediaStatus(message)).toBe("ready");
  });

  it("distingue mídia pendente, leitura parcial e falha", () => {
    expect(messageMediaStatus(pdf)).toBe("pending");
    const partial = {
      ...pdf,
      metadata: { media_context: { status: "partial", text: "Página 1" } },
    };
    expect(messageMediaStatus(partial)).toBe("partial");
    expect(messageContextText(partial)).toContain("Leitura parcial");
    const failed = { ...pdf, metadata: { media_context: { status: "failed" } } };
    expect(messageContextText(failed)).toContain("Mídia não compreendida");
  });

  it("aproveita a transcrição antiga do áudio sem repetir o texto", () => {
    const message = {
      ...pdf,
      message_type: "audio",
      text_content: "Me chama sexta.",
      metadata: {
        transcript_source: "ai",
        media_context: { status: "ready", text: "Me chama sexta." },
      },
    };
    expect(messageContextText(message)).toBe("Me chama sexta.");
    expect(messageMediaStatus(message)).toBe("ready");
  });
});
