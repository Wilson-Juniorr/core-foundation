/**
 * Smart Flow — leitura para a interface.
 *
 * Tudo aqui é derivado do estado real do servidor: nada de contagem local.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import type {
  Commitment,
  ConversationControlView,
  ConversationSmartView,
  SmartFlowConfig,
  SmartFlowSummary,
  SmartPendingAction,
  SmartRunView,
} from "./types";

type Client = SupabaseClient<Database>;

export async function listSmartFlows(db: Client, userId: string): Promise<SmartFlowSummary[]> {
  const { data } = await db
    .from("followup_flows")
    .select("id, name, description, is_active, updated_at, smart_flow_configs(*)")
    .eq("user_id", userId)
    .eq("kind", "smart")
    .order("updated_at", { ascending: false });

  const flows = data ?? [];
  if (flows.length === 0) return [];

  const { data: runs } = await db
    .from("followup_runs")
    .select("flow_id, status")
    .eq("user_id", userId)
    .in(
      "flow_id",
      flows.map((flow) => flow.id),
    );

  return flows.map((flow) => {
    const raw = Array.isArray(flow.smart_flow_configs)
      ? flow.smart_flow_configs[0]
      : flow.smart_flow_configs;
    const config: SmartFlowConfig = {
      flow_id: flow.id,
      goal: raw?.goal ?? "",
      max_duration_days: raw?.max_duration_days ?? 30,
      autonomy: (raw?.autonomy ?? "assist") as SmartFlowConfig["autonomy"],
      allowed_strategies: (raw?.allowed_strategies ?? []) as string[],
      allowed_media: (raw?.allowed_media ?? []) as string[],
      max_pressure: raw?.max_pressure ?? 60,
      min_hours_between_actions: raw?.min_hours_between_actions ?? 24,
      max_actions_per_week: raw?.max_actions_per_week ?? 2,
      handoff_situations: (raw?.handoff_situations ?? []) as string[],
      completion_criteria: raw?.completion_criteria ?? null,
      confidence_min: raw?.confidence_min != null ? Number(raw.confidence_min) : 0.6,
    };
    return {
      id: flow.id,
      name: flow.name,
      description: flow.description,
      is_active: flow.is_active,
      updated_at: flow.updated_at,
      config,
      active_runs: (runs ?? []).filter((run) => run.flow_id === flow.id && run.status === "active")
        .length,
    };
  });
}

export async function getSmartFlow(db: Client, userId: string, flowId: string) {
  const { data } = await db
    .from("followup_flows")
    .select("id, name, description, is_active, window_start, window_end, smart_flow_configs(*)")
    .eq("user_id", userId)
    .eq("id", flowId)
    .eq("kind", "smart")
    .maybeSingle();
  if (!data) return null;
  const config = Array.isArray(data.smart_flow_configs)
    ? data.smart_flow_configs[0]
    : data.smart_flow_configs;
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    is_active: data.is_active,
    window_start: data.window_start,
    window_end: data.window_end,
    config: config ?? null,
  };
}

function toControlView(
  row: Database["public"]["Tables"]["conversation_control"]["Row"],
): ConversationControlView {
  return {
    conversation_id: row.conversation_id,
    owner: row.owner as ConversationControlView["owner"],
    state: row.state as ConversationControlView["state"],
    next_responsible: row.next_responsible as ConversationControlView["next_responsible"],
    next_responsible_reason: row.next_responsible_reason,
    next_responsible_at: row.next_responsible_at,
    buying_stage: row.buying_stage as ConversationControlView["buying_stage"],
    interest_score: row.interest_score != null ? Number(row.interest_score) : null,
    response_probability:
      row.response_probability != null ? Number(row.response_probability) : null,
    pressure_score: row.pressure_score,
    pressure_factors: (row.pressure_factors ?? {}) as Record<string, number>,
    primary_objection: row.primary_objection,
    confidence: row.confidence != null ? Number(row.confidence) : null,

    audio_context_unknown: row.audio_context_unknown,
    decision_reason: row.decision_reason,
    last_inbound_at: row.last_inbound_at,
    last_human_message_at: row.last_human_message_at,
    last_automation_at: row.last_automation_at,
    context_updated_at: row.context_updated_at,
  };
}

/** Visão compacta usada na conversa e na página do cliente. */
export async function getConversationSmartView(
  db: Client,
  userId: string,
  conversationId: string,
): Promise<ConversationSmartView> {
  const [{ data: control }, { data: runs }, { data: commitments }, { data: pending }, basis] =
    await Promise.all([
      db
        .from("conversation_control")
        .select("*")
        .eq("user_id", userId)
        .eq("conversation_id", conversationId)
        .maybeSingle(),
      db
        .from("followup_runs")
        .select(
          "id, status, smart_state, deadline_at, next_evaluation_at, started_at, flow_id, contact_id, conversation_id, contacts(name), followup_flows!inner(name, kind, smart_flow_configs(autonomy))",
        )

        .eq("user_id", userId)
        .eq("conversation_id", conversationId)
        .eq("followup_flows.kind", "smart")
        .in("status", ["active", "paused"])
        .order("started_at", { ascending: false })
        .limit(1),
      db
        .from("commitments")
        .select("*")
        .eq("user_id", userId)
        .eq("conversation_id", conversationId)
        .eq("status", "pending")
        .order("due_at", { ascending: true, nullsFirst: false }),
      db
        .from("scheduled_actions")
        .select(
          "id, status, smart_strategy, content, scheduled_for, decision_reason, requires_approval",
        )
        .eq("user_id", userId)
        .eq("conversation_id", conversationId)
        .not("smart_strategy", "is", null)
        .in("status", ["scheduled", "needs_approval", "stale"])
        .order("scheduled_for", { ascending: true }),
    ]);

  const runRow = (runs ?? [])[0];
  const configAutonomy = runRow
    ? ((Array.isArray(runRow.followup_flows.smart_flow_configs)
        ? runRow.followup_flows.smart_flow_configs[0]?.autonomy
        : (runRow.followup_flows.smart_flow_configs as { autonomy?: string } | null)?.autonomy) ??
      "assist")
    : "assist";

  const run: SmartRunView | null = runRow
    ? {
        id: runRow.id,
        flow_id: runRow.flow_id,
        flow_name: runRow.followup_flows.name,
        contact_id: runRow.contact_id,
        contact_name: runRow.contacts?.name ?? null,
        conversation_id: runRow.conversation_id,
        status: runRow.status,

        smart_state: (runRow.smart_state ?? null) as SmartRunView["smart_state"],
        autonomy: configAutonomy as SmartRunView["autonomy"],
        deadline_at: runRow.deadline_at,
        next_evaluation_at: runRow.next_evaluation_at,
        started_at: runRow.started_at,
      }
    : null;

  return {
    control: control ? toControlView(control) : null,
    run,
    commitments: (commitments ?? []).map((item): Commitment => ({
      id: item.id,
      responsible: item.responsible as Commitment["responsible"],
      commitment_type: item.commitment_type,
      description: item.description,
      due_at: item.due_at,
      due_window_end: item.due_window_end,
      is_ambiguous: item.is_ambiguous,
      status: item.status as Commitment["status"],
      confidence: Number(item.confidence),
      created_at: item.created_at,
    })),
    pending: (pending ?? []).map((item): SmartPendingAction => ({
      id: item.id,
      status: item.status,
      smart_strategy: item.smart_strategy,
      content: item.content,
      scheduled_for: item.scheduled_for,
      decision_reason: item.decision_reason,
      requires_approval: Boolean(item.requires_approval),
      is_stale: item.status === "stale",
    })),
  };
}

/** Fila de aprovações inteligentes do usuário. */
export async function listSmartApprovals(db: Client, userId: string) {
  const { data } = await db
    .from("scheduled_actions")
    .select(
      "id, content, smart_strategy, scheduled_for, decision_reason, status, contact_id, conversation_id, contacts(name)",
    )
    .eq("user_id", userId)
    .in("status", ["needs_approval", "stale"])
    .not("smart_strategy", "is", null)
    .order("scheduled_for", { ascending: true })
    .limit(50);

  return (data ?? []).map((item) => ({
    id: item.id,
    contact_id: item.contact_id,
    contact_name: item.contacts?.name ?? null,
    conversation_id: item.conversation_id,
    strategy: item.smart_strategy,
    content: item.content,
    scheduled_for: item.scheduled_for,
    decision_reason: item.decision_reason,
    is_stale: item.status === "stale",
  }));
}
