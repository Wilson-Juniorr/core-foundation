import type {
  AnalysisStatus,
  CustomerIntent,
  InsightType,
  InterestLevel,
  MemoryField,
  Sentiment,
} from "./types";

export const interestLabels: Record<InterestLevel, string> = {
  unknown: "Não identificado",
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
  very_high: "Muito alto",
};

export const sentimentLabels: Record<Sentiment, string> = {
  positive: "Positivo",
  neutral: "Neutro",
  negative: "Negativo",
  frustrated: "Frustrado",
  unknown: "Não identificado",
};

export const intentLabels: Record<CustomerIntent, string> = {
  unknown: "Não identificada",
  gathering_information: "Buscando informação",
  interested: "Interessado",
  evaluating: "Avaliando",
  negotiating: "Negociando",
  ready_to_close: "Pronto para fechar",
  waiting: "Aguardando",
  not_interested: "Sem interesse",
};

export const memoryFieldLabels: Record<MemoryField, string> = {
  current_summary: "Resumo atual",
  customer_intent: "Intenção",
  interest_level: "Nível de interesse",
  sentiment: "Sentimento",
  next_step_detected: "Próximo passo percebido",
  main_objections: "Principais objeções",
  pending_information: "Pendências",
  customer_commitments: "Compromissos do cliente",
  seller_commitments: "Compromissos do vendedor",
  important_dates: "Datas importantes",
  products_or_services: "Produtos/serviços",
  relevant_values: "Valores relevantes",
  decision_factors: "Fatores de decisão",
  competitors: "Concorrentes",
};

export const analysisStatusLabels: Record<AnalysisStatus, string> = {
  idle: "Sem análise",
  pending: "Na fila",
  processing: "Analisando",
  ready: "Atualizada",
  stale: "Temporariamente desatualizada",
  failed: "Falhou",
};

const insightLabels: Record<string, string> = {
  preferred_name: "Preferência de tratamento",
  purchase_intent: "Intenção de compra",
  desired_product: "Produto desejado",
  information_provided: "Informação fornecida",
  information_missing: "Informação faltante",
  budget: "Orçamento",
  deadline: "Prazo",
  urgency: "Urgência",
  objection_price: "Objeção de preço",
  objection_trust: "Objeção de confiança",
  objection_timing: "Objeção de prazo",
  objection_third_party: "Objeção de terceiros",
  comparing_offers: "Comparando propostas",
  waiting_third_party: "Aguardando outra pessoa",
  customer_commitment: "Compromisso do cliente",
  seller_commitment: "Compromisso do vendedor",
  specific_date: "Data mencionada",
  contact_later: "Pediu contato depois",
  strong_closing_signal: "Sinal de fechamento",
  churn_signal: "Sinal de desistência",
  do_not_contact: "Pediu para não receber mensagens",
  other: "Outro",
};

export function insightLabel(type: InsightType): string {
  return insightLabels[type] ?? type;
}

export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return "Alta";
  if (confidence >= 0.5) return "Média";
  if (confidence > 0) return "Baixa";
  return "—";
}
