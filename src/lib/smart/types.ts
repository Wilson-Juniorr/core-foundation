/**
 * Smart Flow — tipos e vocabulário compartilhados (client-safe).
 *
 * O Smart Flow convive com o fluxo clássico: `followup_flows.kind` decide qual
 * motor conduz a execução. Nada aqui substitui o scheduler, o Policy Engine ou
 * a camada de WhatsApp — apenas acrescenta uma camada de decisão.
 */

export const FLOW_KINDS = ["classic", "smart"] as const;
export type FlowKind = (typeof FLOW_KINDS)[number];

/* ------------------------------- ownership ------------------------------- */

export const CONTROL_OWNERS = ["ai", "human", "none"] as const;
export type ControlOwner = (typeof CONTROL_OWNERS)[number];

export const CONTROL_STATES = [
  "ai_controlled",
  "human_controlled",
  "waiting_customer",
  "waiting_human",
  "waiting_third_party",
  "paused",
  "completed",
] as const;
export type ControlState = (typeof CONTROL_STATES)[number];

export const NEXT_RESPONSIBLES = ["customer", "human", "system", "third_party", "none"] as const;
export type NextResponsible = (typeof NEXT_RESPONSIBLES)[number];

export const BUYING_STAGES = [
  "researching",
  "comparing",
  "validating",
  "deciding",
  "closing",
  "deferred",
  "lost",
  "unknown",
] as const;
export type BuyingStage = (typeof BUYING_STAGES)[number];

export const OWNER_LABELS: Record<ControlOwner, string> = {
  ai: "Automação",
  human: "Você",
  none: "Ninguém",
};

export const CONTROL_STATE_LABELS: Record<ControlState, string> = {
  ai_controlled: "Conduzido pela automação",
  human_controlled: "Conduzido por você",
  waiting_customer: "Aguardando o cliente",
  waiting_human: "Aguardando você",
  waiting_third_party: "Aguardando terceiro",
  paused: "Pausado",
  completed: "Encerrado",
};

export const NEXT_RESPONSIBLE_LABELS: Record<NextResponsible, string> = {
  customer: "Cliente",
  human: "Você",
  system: "Automação",
  third_party: "Terceiro",
  none: "Ninguém",
};

export const BUYING_STAGE_LABELS: Record<BuyingStage, string> = {
  researching: "Pesquisando",
  comparing: "Comparando",
  validating: "Validando informações",
  deciding: "Decidindo",
  closing: "Fechando",
  deferred: "Adiado",
  lost: "Perdido",
  unknown: "Indefinido",
};

/* ------------------------------ estratégias ------------------------------ */

export const SMART_STRATEGIES = [
  "LIGHT_FOLLOWUP",
  "QUESTION_DISCOVERY",
  "PRICE_OBJECTION",
  "VALUE_REINFORCEMENT",
  "DECISION_SIMPLIFICATION",
  "NETWORK_REINFORCEMENT",
  "AUDIO_PROXIMITY",
  "LOW_EFFORT_REPLY",
  "WAITING_DECISION",
  "FUTURE_CALLBACK",
  "REACTIVATION",
  "SOFT_CLOSE",
  "LOSS_REASON_DISCOVERY",
  "GRACEFUL_DECLINE",
  "HUMAN_HANDOFF",
] as const;
export type SmartStrategy = (typeof SMART_STRATEGIES)[number];

export interface SmartStrategyMeta {
  label: string;
  /** Como a mensagem deve soar. Vira instrução para o gerador. */
  intent: string;
  /** Estratégias que apenas chamam o humano nunca enviam mensagem sozinhas. */
  humanOnly?: boolean;
}

export const SMART_STRATEGY_META: Record<SmartStrategy, SmartStrategyMeta> = {
  LIGHT_FOLLOWUP: {
    label: "Toque leve",
    intent: "Retomar contato de forma curta e leve, sem cobrar decisão.",
  },
  QUESTION_DISCOVERY: {
    label: "Pergunta de descoberta",
    intent: "Fazer uma única pergunta aberta para entender o que falta decidir.",
  },
  PRICE_OBJECTION: {
    label: "Objeção de preço",
    intent:
      "Acolher a preocupação com valor e oferecer alternativa de análise, sem citar preços, descontos ou condições que não estejam no material do sistema.",
  },
  VALUE_REINFORCEMENT: {
    label: "Reforço de valor",
    intent: "Reforçar um benefício já apresentado, sem inventar cobertura ou regra.",
  },
  DECISION_SIMPLIFICATION: {
    label: "Simplificar a decisão",
    intent: "Reduzir a decisão a uma escolha simples entre opções já apresentadas.",
  },
  NETWORK_REINFORCEMENT: {
    label: "Reforço de rede",
    intent:
      "Falar da rede credenciada apenas de forma genérica, sem citar hospital ou laboratório específico que não esteja no material.",
  },
  AUDIO_PROXIMITY: {
    label: "Áudio de proximidade",
    intent: "Aproximar por áudio curto e humano (exige material de áudio na Biblioteca).",
  },
  LOW_EFFORT_REPLY: {
    label: "Resposta de baixo esforço",
    intent: "Pedir uma resposta de um toque (sim/não, 1 ou 2).",
  },
  WAITING_DECISION: {
    label: "Aguardar decisão",
    intent: "Não enviar nada: o cliente está decidindo dentro do prazo combinado.",
  },
  FUTURE_CALLBACK: {
    label: "Retorno futuro combinado",
    intent: "Respeitar a data combinada e só retomar no momento pedido pelo cliente.",
  },
  REACTIVATION: {
    label: "Reativação",
    intent: "Reabrir a conversa após longo silêncio, com abordagem diferente das anteriores.",
  },
  SOFT_CLOSE: {
    label: "Encerramento gentil",
    intent: "Encerrar o acompanhamento deixando a porta aberta, sem pressionar.",
  },
  LOSS_REASON_DISCOVERY: {
    label: "Entender a recusa",
    intent:
      "O cliente disse que não tem mais interesse. Agradecer sem insistir, aceitar a decisão e fazer UMA pergunta simples para entender o motivo (atendimento, preço, prazo, escolheu outra opção ou apenas mudou de planos), oferecendo refazer a cotação apenas se o motivo for algo que possa ser ajustado. Nunca cobrar, nunca argumentar contra a decisão.",
  },
  GRACEFUL_DECLINE: {
    label: "Declínio digno",
    intent:
      "Encerrar o acompanhamento com elegância: agradecer o tempo do cliente, registrar que ficou à disposição e deixar claro que não haverá mais contatos automáticos. Nenhuma pergunta, nenhuma nova oferta.",
  },
  HUMAN_HANDOFF: {
    label: "Chamar você",
    intent: "Situação exige atendimento humano.",
    humanOnly: true,
  },
};

export const DEFAULT_ALLOWED_STRATEGIES: SmartStrategy[] = [
  "LIGHT_FOLLOWUP",
  "QUESTION_DISCOVERY",
  "VALUE_REINFORCEMENT",
  "DECISION_SIMPLIFICATION",
  "LOW_EFFORT_REPLY",
  "WAITING_DECISION",
  "FUTURE_CALLBACK",
  "SOFT_CLOSE",
  "HUMAN_HANDOFF",
];

/* -------------------------------- autonomia ------------------------------- */

export const AUTONOMY_MODES = ["observe", "assist", "auto"] as const;
export type AutonomyMode = (typeof AUTONOMY_MODES)[number];

export const AUTONOMY_LABELS: Record<AutonomyMode, string> = {
  observe: "Observar (só sugere)",
  assist: "Assistir (você aprova)",
  auto: "Automático (dentro das regras)",
};

/* ------------------------------ estados do run ---------------------------- */

export const SMART_RUN_STATES = [
  "no_response",
  "waiting_decision",
  "price_objection",
  "validating_information",
  "high_interest",
  "future_callback",
  "human_active",
  "needs_human",
  "closing",
  "refusal_recovery",
  "declining",
  "reactivation",
  "paused",
  "completed",
] as const;
export type SmartRunState = (typeof SMART_RUN_STATES)[number];

export const SMART_RUN_STATE_LABELS: Record<SmartRunState, string> = {
  no_response: "Sem resposta",
  waiting_decision: "Aguardando decisão",
  price_objection: "Objeção de preço",
  validating_information: "Validando informações",
  high_interest: "Interesse alto",
  future_callback: "Retorno combinado",
  human_active: "Você está conduzindo",
  needs_human: "Precisa de você",
  closing: "Fechando",
  refusal_recovery: "Entendendo a recusa",
  declining: "Declinando com elegância",
  reactivation: "Reativação de longo prazo",
  paused: "Pausado",
  completed: "Encerrado",
};

/* ------------------------------ compromissos ------------------------------ */

export const COMMITMENT_RESPONSIBLES = ["customer", "human", "third_party"] as const;
export type CommitmentResponsible = (typeof COMMITMENT_RESPONSIBLES)[number];

export const COMMITMENT_STATUSES = ["pending", "fulfilled", "cancelled", "missed"] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

export interface Commitment {
  id: string;
  commitment_type: string;
  responsible: CommitmentResponsible;
  description: string;
  due_at: string | null;
  due_window_end: string | null;
  is_ambiguous: boolean;
  confidence: number;
  status: CommitmentStatus;
  created_at: string;
}

export const COMMITMENT_RESPONSIBLE_LABELS: Record<CommitmentResponsible, string> = {
  customer: "Cliente",
  human: "Você",
  third_party: "Terceiro",
};

/* ------------------------------ configuração ------------------------------ */

export interface SmartFlowConfig {
  flow_id: string;
  goal: string;
  max_duration_days: number;
  autonomy: AutonomyMode;
  allowed_strategies: string[];
  allowed_media: string[];
  max_pressure: number;
  min_hours_between_actions: number;
  max_actions_per_week: number;
  handoff_situations: string[];
  completion_criteria: string | null;
  confidence_min: number;
}

export interface SmartFlowSummary {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  active_runs: number;
  updated_at: string;
  config: SmartFlowConfig;
}

/* ------------------------- visão da conversa (UI) ------------------------- */

export interface ConversationControlView {
  conversation_id: string;
  owner: ControlOwner;
  state: ControlState;
  next_responsible: NextResponsible;
  next_responsible_reason: string | null;
  next_responsible_at: string | null;
  buying_stage: BuyingStage;
  interest_score: number | null;
  response_probability: number | null;
  primary_objection: string | null;
  pressure_score: number;
  pressure_factors: Record<string, number>;
  audio_context_unknown: boolean;
  confidence: number | null;
  decision_reason: string | null;
  last_inbound_at?: string | null;
  last_human_message_at?: string | null;
  last_automation_at?: string | null;
  context_updated_at: string | null;
}

export interface SmartRunView {
  id: string;
  flow_id: string;
  flow_name: string;
  contact_id: string;
  contact_name: string | null;
  conversation_id: string;
  status: string;
  smart_state: SmartRunState | null;
  autonomy: AutonomyMode;
  deadline_at: string | null;
  next_evaluation_at: string | null;
  started_at: string;
}

export interface SmartPendingAction {
  id: string;
  status: string;
  smart_strategy: string | null;
  content: string | null;
  scheduled_for: string;
  decision_reason: string | null;
  requires_approval: boolean;
  is_stale: boolean;
}

/** O que a IA realmente enxergou ao decidir — serve para auditar a mensagem. */
export interface SmartContextBasis {
  messages_considered: number;
  inbound_count: number;
  outbound_count: number;
  untranscribed_media: number;
  last_inbound_at: string | null;
  last_inbound_preview: string | null;
  memory_summary: string | null;
  memory_updated_at: string | null;
}

export interface ConversationSmartView {
  control: ConversationControlView | null;
  run: SmartRunView | null;
  commitments: Commitment[];
  pending: SmartPendingAction[];
  basis: SmartContextBasis;
}


/** Decisão do orquestrador para o próximo passo do acompanhamento. */
export interface SmartDecision {
  action: "send" | "wait" | "handoff" | "complete";
  strategy: SmartStrategy | null;
  reason: string;
  confidence: number;
  waitHours: number;
  nextResponsible: NextResponsible;
  message: string | null;
  model: string;
  promptVersion: string;
}

export function pressureLabel(score: number): string {
  if (score >= 70) return "Alta";
  if (score >= 40) return "Média";
  return "Baixa";
}

/* ---------------------------- motivos de recusa --------------------------- */

export const LOSS_REASONS = [
  "price",
  "service",
  "competitor",
  "timing",
  "no_need",
  "unresponsive",
  "unknown",
] as const;
export type LossReason = (typeof LOSS_REASONS)[number];

export const LOSS_REASON_LABELS: Record<LossReason, string> = {
  price: "Preço / valor",
  service: "Atendimento",
  competitor: "Escolheu outra opção",
  timing: "Momento inadequado",
  no_need: "Sem necessidade agora",
  unresponsive: "Nunca respondeu",
  unknown: "Não informado",
};
