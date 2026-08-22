export type {
  ContentAsset,
  ContentAssetType,
  DraftStatus,
  GenerationContextSnapshot,
  GenerationResult,
  MessageDraft,
  MessageStrategy,
  StrategyAutonomy,
} from "./types";

import type { ContentAssetType, StrategyAutonomy } from "./types";

/** Payload de criação/edição de um material da biblioteca. */
export interface AssetInput {
  id?: string | undefined;
  name: string;
  type: ContentAssetType;
  purpose: string | null;
  description: string | null;
  body: string | null;
  transcript: string | null;
  tags: string[];
  is_active: boolean;
  storage_reference?: string | null;
  mime_type?: string | null;
  filename?: string | null;
  duration_seconds?: number | null;
}

/** Payload de criação/edição de uma estratégia de mensagem. */
export interface StrategyInput {
  id?: string | undefined;
  name: string;
  objective: string;
  tone: string;
  should_mention: string | null;
  should_avoid: string | null;
  when_to_use: string | null;
  allowed_asset_types: ContentAssetType[];
  allowed_assets: string[];
  forbidden_behaviors: string[];
  autonomy_mode: StrategyAutonomy;
  max_length: number;
  is_active: boolean;
}
