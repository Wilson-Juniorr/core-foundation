/**
 * Módulo 04 — tipos da camada de inteligência.
 *
 * A IA não é fonte de verdade: cada informação carrega origem (`source`),
 * timestamp e, quando aplicável, confiança.
 */

export const MEMORY_SOURCES = ["ai", "human", "system"] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

export const INTEREST_LEVELS = ["unknown", "low", "medium", "high", "very_high"] as const;
export type InterestLevel = (typeof INTEREST_LEVELS)[number];

export const SENTIMENTS = ["positive", "neutral", "negative", "frustrated", "unknown"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const CUSTOMER_INTENTS = [
  "unknown",
  "gathering_information",
  "interested",
  "evaluating",
  "negotiating",
  "ready_to_close",
  "waiting",
  "not_interested",
] as const;
export type CustomerIntent = (typeof CUSTOMER_INTENTS)[number];

/** Tipos de insight — lista extensível, o banco guarda texto livre. */
export const INSIGHT_TYPES = [
  "preferred_name",
  "purchase_intent",
  "desired_product",
  "information_provided",
  "information_missing",
  "budget",
  "deadline",
  "urgency",
  "objection_price",
  "objection_trust",
  "objection_timing",
  "objection_third_party",
  "comparing_offers",
  "waiting_third_party",
  "customer_commitment",
  "seller_commitment",
  "specific_date",
  "contact_later",
  "strong_closing_signal",
  "churn_signal",
  "do_not_contact",
  "other",
] as const;
export type InsightType = (typeof INSIGHT_TYPES)[number] | string;

/** Item de lista da memória. */
export interface MemoryItem {
  value: string;
  confidence: number;
  source: MemorySource;
  at: string;
  /** Data ISO ou texto quando o item se refere a um prazo. */
  due?: string | null;
}

export type MemoryListField =
  | "main_objections"
  | "pending_information"
  | "customer_commitments"
  | "seller_commitments"
  | "important_dates"
  | "products_or_services"
  | "relevant_values"
  | "decision_factors"
  | "competitors";

export type MemoryScalarField =
  "current_summary" | "customer_intent" | "interest_level" | "sentiment" | "next_step_detected";

export type MemoryField = MemoryListField | MemoryScalarField;

export const MEMORY_LIST_FIELDS: MemoryListField[] = [
  "main_objections",
  "pending_information",
  "customer_commitments",
  "seller_commitments",
  "important_dates",
  "products_or_services",
  "relevant_values",
  "decision_factors",
  "competitors",
];

export type AnalysisStatus = "idle" | "pending" | "processing" | "ready" | "stale" | "failed";

export interface CustomerMemory {
  id: string;
  contact_id: string;
  opportunity_id: string | null;
  current_summary: string | null;
  customer_intent: CustomerIntent;
  interest_level: InterestLevel;
  sentiment: Sentiment;
  main_objections: MemoryItem[];
  pending_information: MemoryItem[];
  customer_commitments: MemoryItem[];
  seller_commitments: MemoryItem[];
  important_dates: MemoryItem[];
  products_or_services: MemoryItem[];
  relevant_values: MemoryItem[];
  decision_factors: MemoryItem[];
  competitors: MemoryItem[];
  next_step_detected: string | null;
  do_not_contact: boolean;
  confidence: number;
  last_analyzed_message_id: string | null;
  last_analyzed_at: string | null;
  analysis_status: AnalysisStatus;
  last_error: string | null;
  model: string | null;
  prompt_version: string | null;
  /** Campos travados por confirmação humana. */
  field_sources: Record<string, { source: MemorySource; at: string }>;
  updated_at: string;
}

export interface ConversationInsight {
  id: string;
  insight_type: InsightType;
  content: string;
  confidence: number;
  source: MemorySource;
  status: "open" | "accepted" | "dismissed";
  source_message_id: string | null;
  created_at: string;
}

export interface IntelligenceView {
  memory: CustomerMemory | null;
  insights: ConversationInsight[];
  /** Existe job pendente/em processamento para este contato. */
  processing: boolean;
  /** Mensagens ainda não analisadas. */
  unanalyzedMessages: number;
  usage: {
    analyses: number;
    totalTokens: number;
    estimatedCostUsd: number;
    lastModel: string | null;
  };
}
