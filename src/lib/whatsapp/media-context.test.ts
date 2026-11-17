import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import { markMediaAnalyzed, readContactMedia } from "./media-context.server";
import { getMediaContext, messageContextText, messageMetadata } from "./message-context";

function pdfWithText(text: string): Uint8Array {
  const stream = text ? `BT /F1 12 Tf 20 100 Td (${text}) Tj ET\n` : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 150] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];
  let file = "%PDF-1.4\n";
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(file.length);
    file += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = file.length;
  file += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  file += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  file += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(file);
}

describe("leitura de mídia na fila de análise", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it.each([
    { kind: "document", mime: "application/pdf", filename: "cotacao.pdf", attachment: null },
    { kind: "audio", mime: "audio/ogg", filename: "resposta.ogg", attachment: "input_audio" },
    { kind: "image", mime: "image/png", filename: "proposta.png", attachment: "image_url" },
    {
      kind: "document",
      mime: "application/pdf",
      filename: "digitalizado.pdf",
      attachment: "file",
      scanned: true,
    },
    {
      kind: "audio",
      mime: "audio/ogg",
      filename: "antigo.ogg",
      attachment: "input_audio",
      remote: true,
    },
  ])("processa $kind, preserva a legenda e entrega o texto à memória uma vez", async (sample) => {
    const extractedText = "Porto P220 para duas vidas";
    const gateway = vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as {
        messages: { content: { type: string }[] }[];
      };
      expect(payload.messages[1]?.content[1]?.type).toBe(sample.attachment);
      if (sample.remote) {
        expect(payload.messages[1]?.content[1]).toMatchObject({ input_audio: { format: "mp3" } });
      }
      return Response.json({
        choices: [
          { message: { content: JSON.stringify({ text: extractedText, complete: true }) } },
        ],
      });
    });
    vi.stubEnv("LOVABLE_API_KEY", "test");
    const download = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.hostname === "fixture.uazapi.com" && url.pathname === "/message/download") {
        expect(init?.headers).toMatchObject({ token: "fixture-token" });
        expect(JSON.parse(String(init?.body))).toEqual({
          id: "provider-message",
          generate_mp3: true,
        });
        return Response.json({
          fileURL: "https://fixture.uazapi.com/files/audio.mp3",
          mimetype: "audio/mpeg",
        });
      }
      if (url.hostname === "fixture.uazapi.com" && url.pathname === "/files/audio.mp3")
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "audio/mpeg" },
        });
      return gateway(String(input), init);
    });
    vi.stubGlobal("fetch", download);
    const row = {
      id: "message",
      user_id: "user",
      conversation_id: "conversation",
      contact_id: "contact",
      direction: "outbound",
      sent_at: "2026-11-11T15:00:00Z",
      message_type: sample.kind,
      media_url: sample.remote ? null : `storage:user/conversation/${sample.filename}`,
      external_message_id: sample.remote ? "provider-message" : null,
      media_mime_type: sample.mime,
      media_filename: sample.filename,
      text_content: "Segue a cotação",
      metadata: { source: "manual" } as Database["public"]["Tables"]["messages"]["Row"]["metadata"],
    };
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname.startsWith("/storage/v1/")) {
        const bytes =
          sample.kind === "document"
            ? pdfWithText(sample.scanned ? "" : extractedText)
            : new TextEncoder().encode("fixture");
        return new Response(bytes.buffer as ArrayBuffer, {
          headers: { "content-type": sample.mime },
        });
      }
      if (url.pathname.endsWith("/conversation_control")) return Response.json(null);
      if (url.pathname.endsWith("/conversations"))
        return Response.json({ whatsapp_connection_id: "connection" });
      if (url.pathname.endsWith("/whatsapp_connections"))
        return Response.json({ id: "connection", user_id: "user", provider: "uazapi" });
      if (url.pathname.endsWith("/whatsapp_credentials"))
        return Response.json({ base_url: "https://fixture.uazapi.com", token: "fixture-token" });
      if (!url.pathname.endsWith("/messages"))
        throw new Error(`Consulta inesperada a ${url.pathname}`);
      if (init?.method === "PATCH") {
        expect(url.searchParams.get("user_id")).toBe("eq.user");
        if (url.searchParams.has("metadata->media_context->>claim")) {
          expect(url.searchParams.get("metadata->media_context->>claim")).toBe(
            `eq.${getMediaContext(row.metadata)?.claim}`,
          );
        } else {
          expect(url.searchParams.get("metadata")).toBe(`eq.${JSON.stringify(row.metadata)}`);
        }
        row.metadata = (
          JSON.parse(String(init.body)) as { metadata: typeof row.metadata }
        ).metadata;
        return Response.json({ id: row.id });
      }
      const state = getMediaContext(row.metadata);
      if (url.searchParams.has("id")) return Response.json({ metadata: row.metadata });
      expect(url.searchParams.get("contact_id")).toBe("eq.contact");
      if (url.searchParams.has("metadata->media_context->>status")) {
        return Response.json(state?.status === "ready" && !state.in_memory ? [row] : []);
      }
      return Response.json(state ? [] : [row]);
    });
    const db = createClient<Database>("https://supabase.example", "test", { global: { fetch } });
    const scope = { userId: "user", contactId: "contact" };

    const batch = await readContactMedia(db, scope);
    expect(batch.messages).toHaveLength(1);
    expect(messageContextText(batch.messages[0]!)).toContain("Segue a cotação");
    expect(messageContextText(batch.messages[0]!)).toContain(extractedText);
    expect(gateway).toHaveBeenCalledTimes(sample.attachment ? 1 : 0);
    expect(messageMetadata(row.metadata)["source"]).toBe("manual");
    await markMediaAnalyzed(db, "user", batch.messages);
    expect(await readContactMedia(db, scope)).toEqual({ messages: [], hasMore: false });
  });
});
