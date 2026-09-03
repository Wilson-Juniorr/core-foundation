import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/integrations/supabase/types";
import type { flowInputSchema } from "@/lib/followup.schemas";
import { FollowupError } from "./engine.server";
import type {
  Flow,
  FlowDetail,
  FlowStep,
  FollowupRunView,
  FollowupSummary,
  ScheduledActionView,
} from "./types";

type Client = SupabaseClient<Database>;
type FlowInput = z.infer<typeof flowInputSchema>;

const STEP_COLUMNS =
  "id, flow_id, position, delay_value, delay_unit, action_type, content, media_reference, media_mime_type, media_filename, preferred_time_start, preferred_time_end, content_mode, strategy_id, asset_id, objective";

function mapStep(row: Database["public"]["Tables"]["followup_flow_steps"]["Row"]): FlowStep {
  return {
    id: row.id,
    flow_id: row.flow_id,
    position: row.position,
    delay_value: row.delay_value,
    delay_unit: row.delay_unit,
    action_type: row.action_type,
    content: row.content,
    media_reference: row.media_reference,
    media_mime_type: row.media_mime_type,
    media_filename: row.media_filename,
    preferred_time_start: row.preferred_time_start,
    preferred_time_end: row.preferred_time_end,
    content_mode: row.content_mode,
    strategy_id: row.strategy_id,
    asset_id: row.asset_id,
    objective: row.objective,
  };
}

export async function listFlows(supabase: Client): Promise<Flow[]> {
  // Fluxos inteligentes têm lista própria: aqui só o modo clássico com etapas.
  const { data, error } = await supabase
    .from("followup_flows")
    .select("*, followup_flow_steps(id), followup_runs(id, status)")
    .eq("kind", "classic")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);


  return (data ?? []).map((row) => {
    const steps = (row as { followup_flow_steps: { id: string }[] }).followup_flow_steps ?? [];
    const runs = (row as { followup_runs: { status: string }[] }).followup_runs ?? [];
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      is_active: row.is_active,
      stop_on_reply: row.stop_on_reply,
      window_start: row.window_start,
      window_end: row.window_end,
      step_count: steps.length,
      active_runs: runs.filter((run) => run.status === "active" || run.status === "paused").length,
      updated_at: row.updated_at,
    };
  });
}

export async function getFlow(supabase: Client, flowId: string): Promise<FlowDetail> {
  const [{ data: flow, error }, { data: steps }, { count }] = await Promise.all([
    supabase.from("followup_flows").select("*").eq("id", flowId).maybeSingle(),
    supabase
      .from("followup_flow_steps")
      .select(STEP_COLUMNS)
      .eq("flow_id", flowId)
      .order("position", { ascending: true }),
    supabase
      .from("followup_runs")
      .select("id", { count: "exact", head: true })
      .eq("flow_id", flowId)
      .in("status", ["active", "paused"]),
  ]);
  if (error) throw new Error(error.message);
  if (!flow) throw new FollowupError("Fluxo não encontrado.", "not_found");

  return {
    id: flow.id,
    name: flow.name,
    description: flow.description,
    is_active: flow.is_active,
    stop_on_reply: flow.stop_on_reply,
    window_start: flow.window_start,
    window_end: flow.window_end,
    step_count: (steps ?? []).length,
    active_runs: count ?? 0,
    updated_at: flow.updated_at,
    steps: (steps ?? []).map((step) =>
      mapStep(step as Database["public"]["Tables"]["followup_flow_steps"]["Row"]),
    ),
  };
}

/** Cria ou atualiza um fluxo junto com suas etapas (posições reescritas). */
export async function saveFlow(
  supabase: Client,
  userId: string,
  input: FlowInput,
): Promise<{ flowId: string }> {
  const payload = {
    name: input.name,
    description: input.description,
    is_active: input.is_active,
    stop_on_reply: input.stop_on_reply,
    window_start: input.window_start,
    window_end: input.window_end,
  };

  let flowId = input.id ?? null;

  if (flowId) {
    const { error } = await supabase.from("followup_flows").update(payload).eq("id", flowId);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await supabase
      .from("followup_flows")
      .insert({ ...payload, user_id: userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    flowId = data.id;
  }

  const keepIds = input.steps.map((step) => step.id).filter(Boolean) as string[];

  // Etapas removidas no builder: apagadas apenas se não têm histórico
  // (a FK das ações usa ON DELETE SET NULL, então o histórico permanece).
  let deleteQuery = supabase.from("followup_flow_steps").delete().eq("flow_id", flowId);
  if (keepIds.length > 0) deleteQuery = deleteQuery.not("id", "in", `(${keepIds.join(",")})`);
  const { error: deleteError } = await deleteQuery;
  if (deleteError) throw new Error(deleteError.message);

  for (const [index, step] of input.steps.entries()) {
    const stepPayload = {
      user_id: userId,
      flow_id: flowId,
      position: index + 1,
      delay_value: step.delay_value,
      delay_unit: step.delay_unit,
      action_type: step.action_type,
      content: step.content,
      media_reference: step.media_reference,
      media_mime_type: step.media_mime_type,
      media_filename: step.media_filename,
      preferred_time_start: step.preferred_time_start,
      preferred_time_end: step.preferred_time_end,
      content_mode: step.content_mode,
      strategy_id: step.strategy_id,
      asset_id: step.asset_id,
      objective: step.objective,
    };

    if (step.id) {
      const { error } = await supabase
        .from("followup_flow_steps")
        .update(stepPayload)
        .eq("id", step.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("followup_flow_steps").insert(stepPayload);
      if (error) throw new Error(error.message);
    }
  }

  return { flowId: flowId! };
}

export async function duplicateFlow(
  supabase: Client,
  userId: string,
  flowId: string,
): Promise<{ flowId: string }> {
  const source = await getFlow(supabase, flowId);
  return saveFlow(supabase, userId, {
    name: `${source.name} (cópia)`.slice(0, 120),
    description: source.description,
    is_active: false,
    stop_on_reply: source.stop_on_reply,
    window_start: source.window_start,
    window_end: source.window_end,
    steps: source.steps.map((step) => ({
      delay_value: step.delay_value,
      delay_unit: step.delay_unit,
      action_type: step.action_type,
      content: step.content,
      media_reference: step.media_reference,
      media_mime_type: step.media_mime_type,
      media_filename: step.media_filename,
      preferred_time_start: step.preferred_time_start,
      preferred_time_end: step.preferred_time_end,
      content_mode: step.content_mode,
      strategy_id: step.strategy_id,
      asset_id: step.asset_id,
      objective: step.objective,
    })),
  });
}

/* ------------------------------ leitura de runs ----------------------------- */

const ACTION_COLUMNS =
  "id, flow_run_id, flow_step_id, contact_id, conversation_id, action_type, content, media_filename, scheduled_for, status, cancel_on_reply, attempts, last_error, executed_at, contacts(name)";

type ActionRowWithContact = Database["public"]["Tables"]["scheduled_actions"]["Row"] & {
  contacts: { name: string } | null;
};

export function mapAction(row: ActionRowWithContact): ScheduledActionView {
  return {
    id: row.id,
    flow_run_id: row.flow_run_id,
    flow_step_id: row.flow_step_id,
    contact_id: row.contact_id,
    contact_name: row.contacts?.name ?? null,
    conversation_id: row.conversation_id,
    action_type: row.action_type,
    content: row.content,
    media_filename: row.media_filename,
    scheduled_for: row.scheduled_for,
    status: row.status,
    cancel_on_reply: row.cancel_on_reply,
    attempts: row.attempts,
    last_error: row.last_error,
    executed_at: row.executed_at,
  };
}

type RunRowJoined = Database["public"]["Tables"]["followup_runs"]["Row"] & {
  followup_flows: { name: string; followup_flow_steps: { id: string; position: number }[] } | null;
  contacts: { name: string } | null;
};

async function mapRuns(supabase: Client, rows: RunRowJoined[]): Promise<FollowupRunView[]> {
  if (rows.length === 0) return [];

  const { data: actions } = await supabase
    .from("scheduled_actions")
    .select(ACTION_COLUMNS)
    .in(
      "flow_run_id",
      rows.map((row) => row.id),
    )
    .eq("status", "scheduled")
    .order("scheduled_for", { ascending: true });

  const nextByRun = new Map<string, ScheduledActionView>();
  for (const action of (actions ?? []) as ActionRowWithContact[]) {
    if (action.flow_run_id && !nextByRun.has(action.flow_run_id)) {
      nextByRun.set(action.flow_run_id, mapAction(action));
    }
  }

  return rows.map((row) => {
    const steps = row.followup_flows?.followup_flow_steps ?? [];
    const ordered = [...steps].sort((a, b) => a.position - b.position);
    const currentIndex = ordered.findIndex((step) => step.id === row.current_step_id);
    return {
      id: row.id,
      flow_id: row.flow_id,
      flow_name: row.followup_flows?.name ?? "Fluxo",
      contact_id: row.contact_id,
      contact_name: row.contacts?.name ?? null,
      conversation_id: row.conversation_id,
      opportunity_id: row.opportunity_id,
      status: row.status,
      current_step_position: currentIndex >= 0 ? ordered[currentIndex]!.position : null,
      total_steps: ordered.length,
      remaining_steps:
        currentIndex >= 0 ? Math.max(0, ordered.length - currentIndex - 1) : ordered.length,
      started_at: row.started_at,
      paused_at: row.paused_at,
      stopped_at: row.stopped_at,
      completed_at: row.completed_at,
      stop_reason: row.stop_reason,
      next_action: nextByRun.get(row.id) ?? null,
    };
  });
}

const RUN_SELECT = "*, followup_flows(name, followup_flow_steps(id, position)), contacts(name)";

export async function listRuns(
  supabase: Client,
  statuses: Database["public"]["Enums"]["followup_run_status"][],
): Promise<FollowupRunView[]> {
  const { data, error } = await supabase
    .from("followup_runs")
    .select(RUN_SELECT)
    .in("status", statuses)
    .order("started_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return mapRuns(supabase, (data ?? []) as unknown as RunRowJoined[]);
}

export async function listScheduledActions(
  supabase: Client,
  filter: {
    onlyManual?: boolean;
    statuses?: Database["public"]["Enums"]["scheduled_action_status"][];
  },
): Promise<ScheduledActionView[]> {
  let query = supabase
    .from("scheduled_actions")
    .select(ACTION_COLUMNS)
    .in("status", filter.statuses ?? ["scheduled"])
    .order("scheduled_for", { ascending: true })
    .limit(200);
  if (filter.onlyManual) query = query.is("flow_run_id", null);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as ActionRowWithContact[]).map(mapAction);
}

/** Resumo de acompanhamento de um contato ou de uma conversa. */
export async function loadFollowupSummary(
  supabase: Client,
  filter: { contactId?: string | null; conversationId?: string | null },
): Promise<FollowupSummary> {
  const base = () => {
    let query = supabase.from("followup_runs").select(RUN_SELECT);
    if (filter.conversationId) query = query.eq("conversation_id", filter.conversationId);
    else if (filter.contactId) query = query.eq("contact_id", filter.contactId);
    else query = query.eq("id", "00000000-0000-0000-0000-000000000000");
    return query;
  };

  const [{ data: live }, { data: past }] = await Promise.all([
    base().in("status", ["active", "paused"]).order("started_at", { ascending: false }).limit(1),
    base()
      .in("status", ["stopped", "completed", "cancelled", "failed"])
      .order("stopped_at", { ascending: false, nullsFirst: false })
      .limit(1),
  ]);

  const [runs, pastRuns] = await Promise.all([
    mapRuns(supabase, (live ?? []) as unknown as RunRowJoined[]),
    mapRuns(supabase, (past ?? []) as unknown as RunRowJoined[]),
  ]);

  let scheduledQuery = supabase
    .from("scheduled_actions")
    .select(ACTION_COLUMNS)
    .eq("status", "scheduled")
    .order("scheduled_for", { ascending: true })
    .limit(50);
  if (filter.conversationId)
    scheduledQuery = scheduledQuery.eq("conversation_id", filter.conversationId);
  else if (filter.contactId) scheduledQuery = scheduledQuery.eq("contact_id", filter.contactId);

  const { data: scheduled } = await scheduledQuery;

  return {
    run: runs[0] ?? null,
    last_stopped_run: pastRuns[0] ?? null,
    scheduled: ((scheduled ?? []) as ActionRowWithContact[]).map(mapAction),
  };
}

/** Exclui um fluxo, suas etapas e o histórico de execuções. Fluxos com execução ativa são bloqueados. */
export async function deleteFlow(supabase: Client, flowId: string): Promise<{ ok: true }> {
  const { count, error: countError } = await supabase
    .from("followup_runs")
    .select("id", { count: "exact", head: true })
    .eq("flow_id", flowId)
    .in("status", ["active", "paused"]);
  if (countError) throw new Error(countError.message);

  if ((count ?? 0) > 0) {
    throw new FollowupError(
      "Este fluxo tem execuções em andamento. Pare/desative essas execuções antes de excluir.",
      "run_exists",
    );
  }

  const { data: runIds, error: runsError } = await supabase
    .from("followup_runs")
    .select("id")
    .eq("flow_id", flowId);
  if (runsError) throw new Error(runsError.message);

  const ids = (runIds ?? []).map((r) => r.id);
  if (ids.length > 0) {
    const { error: actionsError } = await supabase
      .from("scheduled_actions")
      .delete()
      .in("flow_run_id", ids);
    if (actionsError) throw new Error(actionsError.message);

    const { error: delRunsError } = await supabase
      .from("followup_runs")
      .delete()
      .eq("flow_id", flowId);
    if (delRunsError) throw new Error(delRunsError.message);
  }

  const { error } = await supabase.from("followup_flows").delete().eq("id", flowId);
  if (error) throw new Error(error.message);
  return { ok: true };
}
