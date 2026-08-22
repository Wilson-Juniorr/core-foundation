/**
 * Módulo 05 — Biblioteca estratégica e motor de mensagens.
 *
 * A IA aqui não conversa com o cliente: ela propõe uma mensagem comercial a
 * partir de contexto REGISTRADO (memória, histórico, etapa, estratégia). Nada
 * é enviado sem passar pelo modo de autonomia da estratégia.
 */

import type { Database } from "@/integrations/supabase/types";

export type ContentAssetType = Database["public"]["Enums"]["content_asset_type"];
export type StrategyAutonomy = Database["public"]["Enums"]["strategy_autonomy"];
export type DraftStatus = Database["public"]["Enums"]["draft_status"];

export const CONTENT_ASSET_TYPES: ContentAssetType[] = ["text", "audio", "image", "document"];
export const STRATEGY_AUTONOMY_MODES: StrategyAutonomy[] = [
  "manual",
  "approval_required",
  "automatic",
];

export interface ContentAsset {
  id: string;
  name: string;
  type: ContentAssetType;
  purpose: string | null;
  description: string | null;
  body: string | null;
  storage_reference: string | null;
  mime_type: string | null;
  filename: string | null;
  duration_seconds: number | null;
  transcript: string | null;
  tags: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MessageStrategy {
  id: string;
  name: string;
  objective: string;
  tone: string;
  should_mention: string | null;
  should_avoid: string | null;
  when_to_use: string | null;
  channel: string;
  allowed_asset_types: ContentAssetType[];
  allowed_assets: string[];
  forbidden_behaviors: string[];
  autonomy_mode: StrategyAutonomy;
  max_length: number;
  is_active: boolean;
  version: number;
  updated_at: string;
}

/** Snapshot do que a IA realmente viu — exibido na UI e guardado no rascunho. */
export interface GenerationContextSnapshot {
  contact: { id: string; name: string; first_name: string };
  opportunity: {
    id: string;
    title: string;
    stage: string;
    status: string;
    estimated_value: number | null;
    next_action: string | null;
  } | null;
  memory: {
    summary: string | null;
    intent: string;
    interest: string;
    sentiment: string;
    next_step: string | null;
    objections: string[];
    pending_information: string[];
    customer_commitments: string[];
    seller_commitments: string[];
    important_dates: string[];
    products: string[];
    values: string[];
    do_not_contact: boolean;
  } | null;
  timing: {
    now_local: string;
    weekday: string;
    timezone: string;
    hours_since_last_contact: number | null;
    hours_since_customer_reply: number | null;
    last_direction: "inbound" | "outbound" | null;
  };
  recent_messages: { direction: "inbound" | "outbound"; at: string; text: string }[];
  recent_outbound: string[];
  assets: { id: string; name: string; type: ContentAssetType; purpose: string | null }[];
  strategy: {
    id: string;
    name: string;
    version: number;
    objective: string;
    tone: string;
    autonomy_mode: StrategyAutonomy;
    when_to_use: string | null;
    should_mention: string | null;
    should_avoid: string | null;
    forbidden_behaviors: string[];
  };
  objective_override: string | null;
  /** Lacunas de contexto — a IA é instruída a não preencher com invenção. */
  gaps: string[];
}

export interface MessageDraft {
  id: string;
  contact_id: string | null;
  contact_name: string | null;
  opportunity_id: string | null;
  conversation_id: string | null;
  strategy_id: string | null;
  strategy_name: string | null;
  strategy_version: number | null;
  generated_content: string;
  original_content: string;
  edited_content: string | null;
  suggested_asset_id: string | null;
  suggested_asset: { id: string; name: string; type: ContentAssetType } | null;
  asset_rationale: string | null;
  status: DraftStatus;
  is_preview: boolean;
  model: string | null;
  prompt_version: string | null;
  context_snapshot: GenerationContextSnapshot | null;
  rejection_reason: string | null;
  created_at: string;
  approved_at: string | null;
  sent_at: string | null;
}

export interface GenerationResult {
  draft: MessageDraft;
  /** Aviso quando a IA se recusou ou o contexto era insuficiente. */
  warning: string | null;
}
