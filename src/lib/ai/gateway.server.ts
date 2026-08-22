/**
 * Cliente mínimo do Lovable AI Gateway (chat completions com JSON estruturado).
 *
 * A chave vive apenas no servidor e nunca é registrada em log.
 */

export class AiGatewayError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryable: boolean,
  ) {
    super(message);
    this.name = "AiGatewayError";
  }
}

export interface GatewayResult<T> {
  data: T;
  model: string;
  usage: { input: number | null; output: number | null; total: number | null };
}

export async function completeStructured<T>(input: {
  model: string;
  system: string;
  user: string;
  schemaName: string;
  schema: unknown;
}): Promise<GatewayResult<T>> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new AiGatewayError("IA não configurada.", 401, false);

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: input.schemaName, strict: true, schema: input.schema },
      },
    }),
  });

  if (!response.ok) {
    const status = response.status;
    let message = "Falha na análise de IA.";
    try {
      const body = (await response.json()) as { error?: { message?: string }; message?: string };
      message = body.error?.message ?? body.message ?? message;
    } catch {
      /* corpo não-JSON */
    }
    if (status === 402) message = message || "Créditos de IA esgotados.";
    throw new AiGatewayError(message, status, status === 429 || status >= 500);
  }

  const payload = (await response.json()) as {
    model?: string;
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new AiGatewayError("Resposta vazia da IA.", 502, true);

  let data: T;
  try {
    data = JSON.parse(content) as T;
  } catch {
    throw new AiGatewayError("Resposta da IA em formato inesperado.", 502, true);
  }

  return {
    data,
    model: payload.model ?? input.model,
    usage: {
      input: payload.usage?.prompt_tokens ?? null,
      output: payload.usage?.completion_tokens ?? null,
      total: payload.usage?.total_tokens ?? null,
    },
  };
}

/** Custo aproximado (USD) — apenas indicativo para o painel de uso. */
export function estimateCost(model: string, totalTokens: number | null): number | null {
  if (totalTokens === null) return null;
  const perMillion = model.includes("flash") ? 0.4 : 3;
  return Number(((totalTokens / 1_000_000) * perMillion).toFixed(6));
}
