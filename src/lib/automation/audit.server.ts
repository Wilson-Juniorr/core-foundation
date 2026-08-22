import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import type { AutomationDecisionKind, PolicyRuleResult } from "./types";

type Admin = SupabaseClient<Database>;

export interface DecisionInput {
  userId: string;
  decision: AutomationDecisionKind;
  reason: string;
  blockedBy?: string | null;
  rules?: PolicyRuleResult[];
  context?: Record<string, unknown>;
  contactId?: string | null;
  conversationId?: string | null;
  opportunityId?: string | null;
  scheduledActionId?: string | null;
  flowRunId?: string | null;
  flowStepId?: string | null;
  strategyId?: string | null;
  strategyName?: string | null;
  strategyVersion?: number | null;
  promptVersion?: string | null;
  model?: string | null;
  confidence?: number | null;
}

/** Auditoria: toda decisão automática é gravada, inclusive as bloqueadas. */
export async function recordDecision(db: Admin, input: DecisionInput): Promise<void> {
  const { error } = await db.from("automation_decisions").insert({
    user_id: input.userId,
    decision: input.decision,
    reason: input.reason.slice(0, 500),
    blocked_by: input.blockedBy ?? null,
    rules: JSON.parse(JSON.stringify(input.rules ?? [])) as Json,
    context: JSON.parse(JSON.stringify(input.context ?? {})) as Json,
    contact_id: input.contactId ?? null,
    conversation_id: input.conversationId ?? null,
    opportunity_id: input.opportunityId ?? null,
    scheduled_action_id: input.scheduledActionId ?? null,
    flow_run_id: input.flowRunId ?? null,
    flow_step_id: input.flowStepId ?? null,
    strategy_id: input.strategyId ?? null,
    strategy_name: input.strategyName ?? null,
    strategy_version: input.strategyVersion ?? null,
    prompt_version: input.promptVersion ?? null,
    model: input.model ?? null,
    confidence: input.confidence ?? null,
  });
  // Auditoria nunca derruba um envio: apenas registramos a falha.
  if (error) console.error("automation_decision_insert_failed", error.message);
}
