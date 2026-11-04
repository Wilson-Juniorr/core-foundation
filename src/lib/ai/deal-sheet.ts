/**
 * Ficha viva do pós-cotação (planos de saúde).
 *
 * Mantida pela IA a cada análise da conversa. Campos corrigidos pelo consultor
 * ficam com origem `human` em `field_sources` e nunca são sobrescritos pela IA.
 */

export const DEAL_STAGES = [
  "unknown",
  "quote_sent",
  "analyzing",
  "consulting_decider",
  "price_objection",
  "comparing",
  "postponed",
  "ready_to_close",
  "closed",
  "lost",
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const TEMPERATURES = ["unknown", "hot", "warm", "cold"] as const;
export type Temperature = (typeof TEMPERATURES)[number];

export const DEAL_SHEET_FIELDS = [
  "deal_stage",
  "decision_maker",
  "quoted_operator",
  "quoted_plan",
  "quoted_value",
  "quoted_lives",
  "temperature",
  "temperature_reason",
] as const;
export type DealSheetField = (typeof DEAL_SHEET_FIELDS)[number];

export interface DealSheet {
  deal_stage: DealStage;
  decision_maker: string | null;
  quoted_operator: string | null;
  quoted_plan: string | null;
  quoted_value: number | null;
  quoted_lives: number | null;
  temperature: Temperature;
  temperature_reason: string | null;
}

export const dealStageLabels: Record<DealStage, string> = {
  unknown: "Não identificada",
  quote_sent: "Cotação enviada",
  analyzing: "Analisando a cotação",
  consulting_decider: "Conversando com quem decide",
  price_objection: "Achou caro",
  comparing: "Comparando com outra opção",
  postponed: "Pediu para chamar depois",
  ready_to_close: "Pronto para fechar",
  closed: "Fechou",
  lost: "Desistiu",
};

export const temperatureLabels: Record<Temperature, string> = {
  unknown: "Sem leitura",
  hot: "Quente",
  warm: "Morno",
  cold: "Frio",
};

export const dealSheetFieldLabels: Record<DealSheetField, string> = {
  deal_stage: "Etapa",
  decision_maker: "Quem decide",
  quoted_operator: "Operadora",
  quoted_plan: "Plano cotado",
  quoted_value: "Valor mensal",
  quoted_lives: "Vidas",
  temperature: "Temperatura",
  temperature_reason: "Motivo da temperatura",
};

function oneOf<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function positive(value: unknown, integer: boolean): number | null {
  const num = typeof value === "string" ? Number(value.replace(",", ".")) : Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return integer ? Math.round(num) : Math.round(num * 100) / 100;
}

/** Normaliza valores vindos do banco ou da IA. */
export function toDealSheet(raw: Record<string, unknown>): DealSheet {
  return {
    deal_stage: oneOf(DEAL_STAGES, raw["deal_stage"], "unknown"),
    decision_maker: text(raw["decision_maker"], 200),
    quoted_operator: text(raw["quoted_operator"], 120),
    quoted_plan: text(raw["quoted_plan"], 200),
    quoted_value: positive(raw["quoted_value"], false),
    quoted_lives: positive(raw["quoted_lives"], true),
    temperature: oneOf(TEMPERATURES, raw["temperature"], "unknown"),
    temperature_reason: text(raw["temperature_reason"], 300),
  };
}

/**
 * Mescla a leitura da IA na ficha atual.
 *
 * - Campo confirmado pelo consultor nunca muda.
 * - Valor vazio / "unknown" da IA nunca apaga um fato já conhecido.
 * - Etapa e temperatura sempre podem evoluir quando a IA traz uma leitura.
 */
export function mergeDealSheet(
  previous: DealSheet,
  incoming: DealSheet,
  humanLocked: (field: DealSheetField) => boolean,
): Partial<DealSheet> {
  const patch: Partial<DealSheet> = {};
  for (const field of DEAL_SHEET_FIELDS) {
    if (humanLocked(field)) continue;
    const next = incoming[field];
    if (next === null || next === "unknown") continue;
    if (next === previous[field]) continue;
    (patch as Record<string, unknown>)[field] = next;
  }
  return patch;
}

/** Linhas da ficha para o prompt do agente. */
export function describeDealSheet(sheet: DealSheet): string[] {
  const plan = [
    sheet.quoted_operator,
    sheet.quoted_plan,
    sheet.quoted_value != null ? `R$ ${sheet.quoted_value.toFixed(2).replace(".", ",")}/mês` : null,
    sheet.quoted_lives != null ? `${sheet.quoted_lives} vida(s)` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return [
    `Etapa do pós-cotação: ${dealStageLabels[sheet.deal_stage]}`,
    `Temperatura: ${temperatureLabels[sheet.temperature]}${sheet.temperature_reason ? ` (${sheet.temperature_reason})` : ""}`,
    `Quem decide: ${sheet.decision_maker ?? "não identificado"}`,
    `Plano cotado: ${plan || "não identificado"}`,
  ];
}
