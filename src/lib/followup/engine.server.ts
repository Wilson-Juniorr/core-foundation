import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { logEvent } from "@/lib/crm.server";
import { waLog } from "@/lib/whatsapp/log.server";
import { firstNameOf, PlaceholderError, renderContent } from "./labels";
import {
  computeScheduledFor,
  DEFAULT_TIMEZONE,
  DEFAULT_WINDOW_END,
  DEFAULT_WINDOW_START,
  isWithinWindow,
  makeWindow,
  mergeWindows,
  nextAllowedInstant,
  type SendWindow,
} from "./time";
import type { DelayUnit, UserSettings } from "./types";

type Admin = SupabaseClient<Database>;

type FlowRow = Database["public"]["Tables"]["followup_flows"]["Row"];
type StepRow = Database["public"]["Tables"]["followup_flow_steps"]["Row"];
type RunRow = Database["public"]["Tables"]["followup_runs"]["Row"];
type ActionRow = Database["public"]["Tables"]["scheduled_actions"]["Row"];

export const MAX_ATTEMPTS = 3;
/** Espaçamento mínimo entre duas automações na mesma conversa. */
const MIN_CONVERSATION_GAP_MINUTES = 5;
/** Reagendamento quando o WhatsApp está desconectado. */
const DISCONNECTED_RETRY_MINUTES = 15;

export class FollowupError extends Error {
  constructor(
    message: string,
    public code:
      | "flow_inactive"
      | "flow_empty"
      | "flow_incomplete"
      | "run_exists"
      | "not_found"
      | "invalid_state"
      | "window"
      | "blocked",
  ) {
    super(message);
    this.name = "FollowupError";
  }
}

export async function adminClient(): Promise<Admin> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Admin;
}

/* ----------------------------- configurações ----------------------------- */

export async function loadUserSettings(db: Admin, userId: string): Promise<UserSettings> {
  const { data } = await db
    .from("user_settings")
    .select("timezone, send_window_start, send_window_end, pause_automation_on_handoff")
    .eq("user_id", userId)
    .maybeSingle();

  return {
    timezone: data?.timezone ?? DEFAULT_TIMEZONE,
    send_window_start: data?.send_window_start ?? DEFAULT_WINDOW_START,
    send_window_end: data?.send_window_end ?? DEFAULT_WINDOW_END,
    pause_automation_on_handoff: data?.pause_automation_on_handoff ?? true,
  };
}

function windowFor(
  settings: UserSettings,
  flow: Pick<FlowRow, "window_start" | "window_end"> | null,
  step: Pick<StepRow, "preferred_time_start" | "preferred_time_end"> | null,
): SendWindow | null {
  return mergeWindows(
    makeWindow(settings.send_window_start, settings.send_window_end),
    flow ? makeWindow(flow.window_start, flow.window_end) : null,
    step ? makeWindow(step.preferred_time_start, step.preferred_time_end) : null,
  );
}

/* --------------------------- deteção de resposta -------------------------- */

const REAL_INBOUND_TYPES: Database["public"]["Enums"]["message_type"][] = [
  "text",
  "audio",
  "image",
  "document",
  "video",
];

/**
 * Uma resposta válida é qualquer mensagem real (texto ou mídia) recebida do
 * cliente depois do instante informado. Recibos de leitura/entrega e eventos
 * técnicos não chegam aqui porque não são persistidos como mensagens inbound.
 */
export async function hasInboundReplyAfter(
  db: Admin,
  conversationId: string,
  afterIso: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("messages")
    .select("id, sent_at")
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound")
    .in("message_type", REAL_INBOUND_TYPES)
    .gt("sent_at", afterIso)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    waLog.warn("reply_lookup_failed", { reason: error.message });
    return null;
  }
  return data?.sent_at ?? null;
}

/* ------------------------------ agendamento ------------------------------ */

function idempotencyKeyForStep(runId: string, stepId: string): string {
  // Uma etapa executa no máximo uma vez por run: a chave é natural.
  return `run:${runId}:step:${stepId}`;
}

async function conversationGapShift(
  db: Admin,
  conversationId: string,
  candidate: Date,
  ignoreActionId: string | null,
): Promise<Date> {
  const windowStart = new Date(
    candidate.getTime() - MIN_CONVERSATION_GAP_MINUTES * 60_000,
  ).toISOString();
  const windowEnd = new Date(
    candidate.getTime() + MIN_CONVERSATION_GAP_MINUTES * 60_000,
  ).toISOString();

  let query = db
    .from("scheduled_actions")
    .select("id, scheduled_for")
    .eq("conversation_id", conversationId)
    .in("status", ["scheduled", "processing"])
    .gte("scheduled_for", windowStart)
    .lte("scheduled_for", windowEnd)
    .order("scheduled_for", { ascending: false })
    .limit(1);
  if (ignoreActionId) query = query.neq("id", ignoreActionId);

  const { data } = await query.maybeSingle();
  if (!data) return candidate;
  return new Date(new Date(data.scheduled_for).getTime() + MIN_CONVERSATION_GAP_MINUTES * 60_000);
}

/**
 * Cria (ou reaproveita, via idempotency_key) a ação agendada de uma etapa.
 */
async function scheduleStep(
  db: Admin,
  input: {
    userId: string;
    run: RunRow;
    flow: FlowRow;
    step: StepRow;
    settings: UserSettings;
    from: Date;
    now: Date;
  },
): Promise<ActionRow | null> {
  const window = windowFor(input.settings, input.flow, input.step);
  let scheduledFor = computeScheduledFor({
    from: input.from,
    now: input.now,
    delayValue: input.step.delay_value,
    delayUnit: input.step.delay_unit as DelayUnit,
    window,
    timezone: input.settings.timezone,
  });
  scheduledFor = await conversationGapShift(db, input.run.conversation_id, scheduledFor, null);
  scheduledFor = nextAllowedInstant(scheduledFor, window, input.settings.timezone);

  const key = idempotencyKeyForStep(input.run.id, input.step.id);

  // Etapa de mídia com arquivo próprio anexado tem prioridade sobre o material
  // da Biblioteca (que pode estar sem arquivo). Evita bloqueio no envio.
  const hasOwnFile =
    input.step.action_type !== "text_message" && Boolean(input.step.media_reference);
  const effectiveMode =
    input.step.content_mode === "asset_selection" && hasOwnFile
      ? "fixed_content"
      : input.step.content_mode;

  const { data, error } = await db
    .from("scheduled_actions")
    .insert({
      user_id: input.userId,
      flow_run_id: input.run.id,
      flow_step_id: input.step.id,
      contact_id: input.run.contact_id,
      conversation_id: input.run.conversation_id,
      opportunity_id: input.run.opportunity_id,
      action_type: input.step.action_type,
      content: input.step.content,
      media_reference:
        effectiveMode === "asset_selection" ? input.step.asset_id : input.step.media_reference,
      media_mime_type: input.step.media_mime_type,
      media_filename: input.step.media_filename,
      content_mode: effectiveMode,
      strategy_id: input.step.strategy_id,

      scheduled_for: scheduledFor.toISOString(),
      cancel_on_reply: input.flow.stop_on_reply,
      idempotency_key: key,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      // Já existe: outra execução do motor criou a mesma ação.
      const { data: existing } = await db
        .from("scheduled_actions")
        .select("*")
        .eq("user_id", input.userId)
        .eq("idempotency_key", key)
        .maybeSingle();
      return existing ?? null;
    }
    throw new Error(error.message);
  }

  await db.from("followup_runs").update({ current_step_id: input.step.id }).eq("id", input.run.id);

  return data;
}

async function loadFlowWithSteps(db: Admin, userId: string, flowId: string) {
  const [{ data: flow }, { data: steps }] = await Promise.all([
    db.from("followup_flows").select("*").eq("id", flowId).eq("user_id", userId).maybeSingle(),
    db
      .from("followup_flow_steps")
      .select("*")
      .eq("flow_id", flowId)
      .eq("user_id", userId)
      .order("position", { ascending: true }),
  ]);
  if (!flow) throw new FollowupError("Fluxo não encontrado.", "not_found");
  if (!steps || steps.length === 0) {
    throw new FollowupError("Este fluxo ainda não possui etapas.", "flow_empty");
  }
  return { flow, steps };
}

/**
 * Verificação preventiva: nenhum fluxo começa se alguma etapa depender de um
 * material (áudio/imagem/documento) que ainda não tem arquivo anexado. Antes,
 * isso só aparecia horas depois, quando a etapa era bloqueada no envio.
 */
async function assertFlowMaterialsReady(
  db: Admin,
  userId: string,
  steps: StepRow[],
): Promise<void> {
  const assetIds = steps
    .filter((step) => step.content_mode === "asset_selection")
    .map((step) => step.asset_id)
    .filter((id): id is string => Boolean(id));

  const problems: string[] = [];

  for (const step of steps) {
    if (step.content_mode === "asset_selection" && !step.asset_id) {
      problems.push(`Etapa ${step.position}: nenhum material selecionado`);
    }
    if (
      step.content_mode === "fixed_content" &&
      step.action_type !== "text_message" &&
      !step.media_reference
    ) {
      problems.push(`Etapa ${step.position}: arquivo não anexado`);
    }
  }

  if (assetIds.length > 0) {
    const { data: assets } = await db
      .from("content_assets")
      .select("id, name, type, storage_reference, body")
      .eq("user_id", userId)
      .in("id", assetIds);

    const byId = new Map((assets ?? []).map((asset) => [asset.id, asset]));
    for (const step of steps) {
      if (step.content_mode !== "asset_selection" || !step.asset_id) continue;
      const asset = byId.get(step.asset_id);
      if (!asset) {
        problems.push(`Etapa ${step.position}: material não encontrado`);
        continue;
      }
      const ready = asset.type === "text" ? Boolean(asset.body) : Boolean(asset.storage_reference);
      if (!ready) {
        problems.push(`Etapa ${step.position}: "${asset.name}" ainda sem arquivo`);
      }
    }
  }

  if (problems.length > 0) {
    throw new FollowupError(
      `Este fluxo ainda não está pronto para iniciar. ${problems.join("; ")}. Anexe os materiais na Biblioteca antes de iniciar.`,
      "flow_incomplete",
    );
  }
}

/* ------------------------------ iniciar fluxo ----------------------------- */

export async function previewFlow(
  userId: string,
  flowId: string,
): Promise<{
  flow_name: string;
  step_count: number;
  first_action_type: StepRow["action_type"];
  first_action_at: string;
  first_action_content: string | null;
}> {
  const db = await adminClient();
  const { flow, steps } = await loadFlowWithSteps(db, userId, flowId);
  const settings = await loadUserSettings(db, userId);
  const first = steps[0]!;
  const now = new Date();
  const scheduledFor = computeScheduledFor({
    from: now,
    now,
    delayValue: first.delay_value,
    delayUnit: first.delay_unit as DelayUnit,
    window: windowFor(settings, flow, first),
    timezone: settings.timezone,
  });

  return {
    flow_name: flow.name,
    step_count: steps.length,
    first_action_type: first.action_type,
    first_action_at: scheduledFor.toISOString(),
    first_action_content: first.content,
  };
}

export async function findLiveRun(db: Admin, conversationId: string) {
  const { data } = await db
    .from("followup_runs")
    .select("*")
    .eq("conversation_id", conversationId)
    .in("status", ["active", "paused"])
    .maybeSingle();
  return data;
}

/**
 * Bloqueios reais antes de iniciar: preferências do cliente. As demais regras
 * (janela, cooldown, modo teste, limites) seguem no Policy Engine no envio.
 */
async function assertContactAllowsAutomation(db: Admin, contactId: string): Promise<void> {
  const { data } = await db
    .from("contact_preferences")
    .select("automation_allowed, whatsapp_allowed, do_not_contact")
    .eq("contact_id", contactId)
    .maybeSingle();
  if (!data) return;
  if (data.do_not_contact) {
    throw new FollowupError("Este cliente pediu para não ser contatado.", "blocked");
  }
  if (!data.automation_allowed) {
    throw new FollowupError("Automação desativada para este cliente.", "blocked");
  }
  if (!data.whatsapp_allowed) {
    throw new FollowupError("Envio por WhatsApp desativado para este cliente.", "blocked");
  }
}

export async function startFlow(
  userId: string,
  input: {
    flowId: string;
    contactId: string;
    /** Opcional: quando ausente, a conversa é localizada/criada pelo telefone. */
    conversationId?: string | null | undefined;
    opportunityId?: string | null | undefined;
    replaceExisting?: boolean | undefined;
  },
): Promise<{ runId: string }> {
  const db = await adminClient();
  const { flow, steps } = await loadFlowWithSteps(db, userId, input.flowId);
  if (!flow.is_active) throw new FollowupError("Este fluxo está desativado.", "flow_inactive");
  await assertFlowMaterialsReady(db, userId, steps);

  await assertContactAllowsAutomation(db, input.contactId);

  // Cliente cadastrado manualmente: localiza, importa ou cria a conversa.
  let conversationId = input.conversationId ?? null;
  if (!conversationId) {
    const { ensureConversationForContact } = await import("@/lib/whatsapp/link.server");
    const resolution = await ensureConversationForContact(userId, input.contactId);
    conversationId = resolution.conversationId;
  }

  const existing = await findLiveRun(db, conversationId);
  if (existing) {
    if (!input.replaceExisting) {
      throw new FollowupError("Este cliente já possui um acompanhamento ativo.", "run_exists");
    }
    await cancelRun(userId, existing.id, "replaced");
  }

  const settings = await loadUserSettings(db, userId);
  const now = new Date();

  const { data: run, error } = await db
    .from("followup_runs")
    .insert({
      user_id: userId,
      flow_id: flow.id,
      contact_id: input.contactId,
      conversation_id: conversationId,

      opportunity_id: input.opportunityId ?? null,
      status: "active",
      started_at: now.toISOString(),
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new FollowupError("Este cliente já possui um acompanhamento ativo.", "run_exists");
    }
    throw new Error(error.message);
  }

  const action = await scheduleStep(db, {
    userId,
    run,
    flow,
    step: steps[0]!,
    settings,
    from: now,
    now,
  });

  await logEvent(db, userId, {
    event_type: "followup_started",
    contact_id: input.contactId,
    opportunity_id: input.opportunityId ?? null,
    metadata: {
      flow_run_id: run.id,
      flow_id: flow.id,
      flow_name: flow.name,
      conversation_id: conversationId,

      first_action_at: action?.scheduled_for ?? null,
      step_count: steps.length,
    },
  });

  return { runId: run.id };
}

/* ------------------------- pausar / retomar / cancelar ------------------------- */

async function cancelFutureActions(
  db: Admin,
  runId: string,
  status: "cancelled" | "skipped",
  reason: string,
): Promise<number> {
  const { data } = await db
    .from("scheduled_actions")
    .update({ status, last_error: reason })
    .eq("flow_run_id", runId)
    .eq("status", "scheduled")
    .select("id");
  return data?.length ?? 0;
}

export async function pauseRun(userId: string, runId: string): Promise<void> {
  const db = await adminClient();
  const { data: run } = await db
    .from("followup_runs")
    .select("*")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!run) throw new FollowupError("Acompanhamento não encontrado.", "not_found");
  if (run.status !== "active") {
    throw new FollowupError("Somente acompanhamentos ativos podem ser pausados.", "invalid_state");
  }

  // As ações continuam agendadas; o executor ignora runs pausados e o retomar
  // recalcula o horário preservando o intervalo restante.
  await db
    .from("followup_runs")
    .update({ status: "paused", paused_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("status", "active");

  await logEvent(db, userId, {
    event_type: "followup_paused",
    contact_id: run.contact_id,
    opportunity_id: run.opportunity_id,
    metadata: { flow_run_id: runId, flow_id: run.flow_id },
  });
}

export async function resumeRun(userId: string, runId: string): Promise<void> {
  const db = await adminClient();
  const { data: run } = await db
    .from("followup_runs")
    .select("*")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!run) throw new FollowupError("Acompanhamento não encontrado.", "not_found");
  if (run.status !== "paused") {
    throw new FollowupError("Este acompanhamento não está pausado.", "invalid_state");
  }

  const now = new Date();
  const settings = await loadUserSettings(db, userId);
  const { data: flow } = await db
    .from("followup_flows")
    .select("*")
    .eq("id", run.flow_id)
    .maybeSingle();

  // Inclui ações que ficaram bloqueadas (ex.: material sem arquivo): retomar
  // significa voltar exatamente do passo onde o fluxo parou.
  const { data: pending } = await db
    .from("scheduled_actions")
    .select("*")
    .eq("flow_run_id", runId)
    .in("status", ["scheduled", "blocked"])
    .order("scheduled_for", { ascending: true });

  const pausedAt = run.paused_at ? new Date(run.paused_at).getTime() : now.getTime();

  for (const action of pending ?? []) {
    const { data: step } = action.flow_step_id
      ? await db.from("followup_flow_steps").select("*").eq("id", action.flow_step_id).maybeSingle()
      : { data: null };

    const wasBlocked = action.status === "blocked";
    // Preserva o intervalo relativo que faltava quando o fluxo foi pausado:
    // evita explosão de mensagens atrasadas ao retomar. Ações bloqueadas já
    // estavam vencidas, então voltam para a fila imediatamente.
    const remainingMs = wasBlocked
      ? 0
      : Math.max(0, new Date(action.scheduled_for).getTime() - pausedAt);
    const window = windowFor(settings, flow ?? null, step ?? null);
    let next = nextAllowedInstant(new Date(now.getTime() + remainingMs), window, settings.timezone);
    next = await conversationGapShift(db, action.conversation_id, next, action.id);
    next = nextAllowedInstant(next, window, settings.timezone);

    await db
      .from("scheduled_actions")
      .update({
        status: "scheduled",
        scheduled_for: next.toISOString(),
        last_error: null,
        ...(wasBlocked ? { attempts: 0 } : {}),
      })
      .eq("id", action.id)
      .in("status", ["scheduled", "blocked"]);
  }

  await db
    .from("followup_runs")
    .update({ status: "active", paused_at: null })
    .eq("id", runId)
    .eq("status", "paused");

  await logEvent(db, userId, {
    event_type: "followup_resumed",
    contact_id: run.contact_id,
    opportunity_id: run.opportunity_id,
    metadata: { flow_run_id: runId, flow_id: run.flow_id },
  });
}

export async function cancelRun(
  userId: string,
  runId: string,
  reason: "manually_cancelled" | "replaced" = "manually_cancelled",
): Promise<void> {
  const db = await adminClient();
  const { data: run } = await db
    .from("followup_runs")
    .select("*")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!run) throw new FollowupError("Acompanhamento não encontrado.", "not_found");
  if (!["active", "paused"].includes(run.status)) return;

  const cancelled = await cancelFutureActions(db, runId, "cancelled", reason);

  // Histórico nunca é apagado: apenas encerramos o run.
  await db
    .from("followup_runs")
    .update({
      status: "cancelled",
      stopped_at: new Date().toISOString(),
      stop_reason: reason,
    })
    .eq("id", runId)
    .in("status", ["active", "paused"]);

  await logEvent(db, userId, {
    event_type: "followup_stopped",
    contact_id: run.contact_id,
    opportunity_id: run.opportunity_id,
    metadata: {
      flow_run_id: runId,
      flow_id: run.flow_id,
      stop_reason: reason,
      cancelled_actions: cancelled,
    },
  });
}

/* --------------------- interrupção por resposta do cliente --------------------- */

/**
 * Chamado server-side sempre que uma mensagem inbound real é persistida
 * (webhook). Não depende de nenhuma página aberta.
 */
export async function stopRunsForReply(input: {
  userId: string;
  conversationId: string;
  repliedAt: string;
}): Promise<{ stoppedRuns: number; cancelledActions: number }> {
  const db = await adminClient();
  let stoppedRuns = 0;
  let cancelledActions = 0;

  const { data: runs } = await db
    .from("followup_runs")
    .select("*, followup_flows(stop_on_reply, name)")
    .eq("user_id", input.userId)
    .eq("conversation_id", input.conversationId)
    .in("status", ["active", "paused"]);

  for (const run of runs ?? []) {
    const flow = (
      run as RunRow & { followup_flows: { stop_on_reply: boolean; name: string } | null }
    ).followup_flows;
    if (!flow?.stop_on_reply) continue;
    // Só respostas posteriores ao início do fluxo interrompem.
    if (new Date(input.repliedAt).getTime() < new Date(run.started_at).getTime()) continue;

    cancelledActions += await cancelFutureActions(db, run.id, "cancelled", "customer_replied");

    const { data: updated } = await db
      .from("followup_runs")
      .update({
        status: "stopped",
        stopped_at: input.repliedAt,
        stop_reason: "customer_replied",
      })
      .eq("id", run.id)
      .in("status", ["active", "paused"])
      .select("id");

    if (updated && updated.length > 0) {
      stoppedRuns += 1;
      await logEvent(db, input.userId, {
        event_type: "followup_stopped",
        contact_id: run.contact_id,
        opportunity_id: run.opportunity_id,
        metadata: {
          flow_run_id: run.id,
          flow_id: run.flow_id,
          flow_name: flow.name,
          stop_reason: "customer_replied",
          conversation_id: input.conversationId,
        },
      });
    }
  }

  // Agendamentos avulsos marcados para cancelar em caso de resposta.
  const { data: manual } = await db
    .from("scheduled_actions")
    .update({ status: "cancelled", last_error: "customer_replied" })
    .eq("user_id", input.userId)
    .eq("conversation_id", input.conversationId)
    .is("flow_run_id", null)
    .eq("status", "scheduled")
    .eq("cancel_on_reply", true)
    .select("id, contact_id");

  for (const action of manual ?? []) {
    cancelledActions += 1;
    await logEvent(db, input.userId, {
      event_type: "scheduled_message_cancelled",
      contact_id: action.contact_id,
      metadata: {
        scheduled_action_id: action.id,
        conversation_id: input.conversationId,
        reason: "customer_replied",
      },
    });
  }

  if (stoppedRuns > 0 || cancelledActions > 0) {
    waLog.info("followup_stopped_by_reply", {
      conversation_id: input.conversationId,
      runs: stoppedRuns,
      actions: cancelledActions,
    });
  }

  return { stoppedRuns, cancelledActions };
}

/* ------------------------- agendamento individual ------------------------- */

export async function scheduleManualMessage(
  userId: string,
  input: {
    conversationId: string;
    contactId?: string | null | undefined;
    opportunityId?: string | null | undefined;
    scheduledFor: string;
    actionType: Database["public"]["Enums"]["followup_action_type"];
    content: string | null;
    mediaReference: string | null;
    mediaMimeType: string | null;
    mediaFilename: string | null;
    cancelOnReply: boolean;
  },
): Promise<{ actionId: string; scheduledFor: string }> {
  const db = await adminClient();
  const settings = await loadUserSettings(db, userId);
  const now = new Date();

  const requested = new Date(input.scheduledFor);
  const window = makeWindow(settings.send_window_start, settings.send_window_end);
  let scheduledFor = nextAllowedInstant(
    requested.getTime() < now.getTime() ? now : requested,
    window,
    settings.timezone,
  );
  scheduledFor = await conversationGapShift(db, input.conversationId, scheduledFor, null);
  scheduledFor = nextAllowedInstant(scheduledFor, window, settings.timezone);

  const { data, error } = await db
    .from("scheduled_actions")
    .insert({
      user_id: userId,
      conversation_id: input.conversationId,
      contact_id: input.contactId ?? null,
      opportunity_id: input.opportunityId ?? null,
      action_type: input.actionType,
      content: input.content,
      media_reference: input.mediaReference,
      media_mime_type: input.mediaMimeType,
      media_filename: input.mediaFilename,
      scheduled_for: scheduledFor.toISOString(),
      cancel_on_reply: input.cancelOnReply,
      idempotency_key: `manual:${crypto.randomUUID()}`,
    })
    .select("id, scheduled_for")
    .single();
  if (error) throw new Error(error.message);

  await logEvent(db, userId, {
    event_type: "scheduled_message_created",
    contact_id: input.contactId ?? null,
    opportunity_id: input.opportunityId ?? null,
    metadata: {
      scheduled_action_id: data.id,
      conversation_id: input.conversationId,
      scheduled_for: data.scheduled_for,
      action_type: input.actionType,
    },
  });

  return { actionId: data.id, scheduledFor: data.scheduled_for };
}

export async function cancelScheduledAction(userId: string, actionId: string): Promise<void> {
  const db = await adminClient();
  const { data } = await db
    .from("scheduled_actions")
    .update({ status: "cancelled", last_error: "manually_cancelled" })
    .eq("id", actionId)
    .eq("user_id", userId)
    .eq("status", "scheduled")
    .select("id, contact_id, conversation_id, flow_run_id")
    .maybeSingle();
  if (!data) throw new FollowupError("Agendamento não encontrado ou já processado.", "not_found");

  await logEvent(db, userId, {
    event_type: "scheduled_message_cancelled",
    contact_id: data.contact_id,
    metadata: {
      scheduled_action_id: data.id,
      conversation_id: data.conversation_id,
      flow_run_id: data.flow_run_id,
      reason: "manually_cancelled",
    },
  });
}

/* --------------------------------- executor -------------------------------- */

type ExecutionOutcome = "sent" | "cancelled" | "skipped" | "rescheduled" | "failed" | "raced";

export interface TickResult {
  claimed: number;
  sent: number;
  cancelled: number;
  skipped: number;
  rescheduled: number;
  failed: number;
}

/**
 * Encontra ações vencidas e as executa. Roda no servidor (cron), sem depender
 * de nenhum browser aberto.
 */
export async function runDueActions(limit = 25): Promise<TickResult> {
  const db = await adminClient();
  const nowIso = new Date().toISOString();

  const { data: due, error } = await db
    .from("scheduled_actions")
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const result: TickResult = {
    claimed: 0,
    sent: 0,
    cancelled: 0,
    skipped: 0,
    rescheduled: 0,
    failed: 0,
  };

  for (const candidate of due ?? []) {
    // Claim atômico: apenas um worker consegue mover scheduled → processing.
    const { data: claimed } = await db
      .from("scheduled_actions")
      .update({ status: "processing" })
      .eq("id", candidate.id)
      .eq("status", "scheduled")
      .select("*")
      .maybeSingle();
    if (!claimed) continue;

    result.claimed += 1;
    const outcome = await executeClaimedAction(db, claimed);
    if (outcome === "sent") result.sent += 1;
    else if (outcome === "cancelled") result.cancelled += 1;
    else if (outcome === "skipped") result.skipped += 1;
    else if (outcome === "rescheduled") result.rescheduled += 1;
    else if (outcome === "failed") result.failed += 1;
  }

  return result;
}

async function releaseAction(
  db: Admin,
  action: ActionRow,
  patch: Database["public"]["Tables"]["scheduled_actions"]["Update"],
) {
  await db.from("scheduled_actions").update(patch).eq("id", action.id).eq("status", "processing");
}

async function executeClaimedAction(db: Admin, action: ActionRow): Promise<ExecutionOutcome> {
  const settings = await loadUserSettings(db, action.user_id);
  const now = new Date();

  let run: RunRow | null = null;
  let flow: FlowRow | null = null;

  if (action.flow_run_id) {
    const { data } = await db
      .from("followup_runs")
      .select("*")
      .eq("id", action.flow_run_id)
      .maybeSingle();
    run = data ?? null;

    if (!run) {
      await releaseAction(db, action, { status: "cancelled", last_error: "run_missing" });
      return "cancelled";
    }
    if (run.status === "paused") {
      // Pausado: devolve para a fila sem consumir tentativa.
      await releaseAction(db, action, { status: "scheduled" });
      return "rescheduled";
    }
    if (run.status !== "active") {
      await releaseAction(db, action, { status: "cancelled", last_error: `run_${run.status}` });
      return "cancelled";
    }

    const { data: flowRow } = await db
      .from("followup_flows")
      .select("*")
      .eq("id", run.flow_id)
      .maybeSingle();
    flow = flowRow ?? null;
  }

  /* Última verificação de resposta imediatamente antes do envio: fecha a
     corrida entre "cliente respondeu às 09:59:59" e "executor às 10:00". */
  if (action.cancel_on_reply) {
    const since = run ? run.started_at : action.created_at;
    const repliedAt = await hasInboundReplyAfter(db, action.conversation_id, since);
    if (repliedAt) {
      await releaseAction(db, action, { status: "cancelled", last_error: "customer_replied" });
      await stopRunsForReply({
        userId: action.user_id,
        conversationId: action.conversation_id,
        repliedAt,
      });
      return "cancelled";
    }
  }

  // Janela permitida: nunca enviamos fora do horário configurado.
  const step = action.flow_step_id
    ? (await db.from("followup_flow_steps").select("*").eq("id", action.flow_step_id).maybeSingle())
        .data
    : null;
  const window = windowFor(settings, flow, step ?? null);
  if (!isWithinWindow(now, window, settings.timezone)) {
    const next = nextAllowedInstant(now, window, settings.timezone);
    await releaseAction(db, action, {
      status: "scheduled",
      scheduled_for: next.toISOString(),
      last_error: "outside_window",
    });
    return "rescheduled";
  }

  // WhatsApp desconectado: a ação é preservada e reagendada, nunca perdida.
  const { loadPrimaryConnection } = await import("@/lib/whatsapp/store.server");
  const connection = await loadPrimaryConnection(db, action.user_id);
  if (!connection || connection.status !== "connected") {
    const retryAt = nextAllowedInstant(
      new Date(now.getTime() + DISCONNECTED_RETRY_MINUTES * 60_000),
      window,
      settings.timezone,
    );
    await releaseAction(db, action, {
      status: "scheduled",
      scheduled_for: retryAt.toISOString(),
      last_error: "whatsapp_disconnected",
    });
    return "rescheduled";
  }

  // Conteúdo: placeholders determinísticos, sem IA.
  let text: string | null = action.content;
  if (text) {
    const { data: contact } = action.contact_id
      ? await db.from("contacts").select("name").eq("id", action.contact_id).maybeSingle()
      : { data: null };
    const { data: conversation } = await db
      .from("conversations")
      .select("display_name")
      .eq("id", action.conversation_id)
      .maybeSingle();
    const name = contact?.name ?? conversation?.display_name ?? null;
    try {
      text = renderContent(text, { name, firstName: firstNameOf(name) });
    } catch (error) {
      if (error instanceof PlaceholderError) {
        await failAction(db, action, run, `placeholder:${error.placeholder}`, true);
        return "failed";
      }
      throw error;
    }
  }

  /* Módulo 07 — Orquestrador: políticas, silêncio inteligente e guardrails.
     Nada é enviado sem passar por aqui, e toda decisão fica auditada. */
  const { loadPolicySettings, evaluatePolicy } = await import("@/lib/automation/policy.server");
  const { recordDecision } = await import("@/lib/automation/audit.server");
  const { resolveAdaptiveContent } = await import("@/lib/automation/adaptive.server");

  const policy = await loadPolicySettings(db, action.user_id);
  const evaluation = await evaluatePolicy(db, policy, {
    userId: action.user_id,
    conversationId: action.conversation_id,
    contactId: action.contact_id,
    flowRunId: action.flow_run_id,
    now,
  });

  const auditBase = {
    userId: action.user_id,
    contactId: action.contact_id,
    conversationId: action.conversation_id,
    opportunityId: action.opportunity_id,
    scheduledActionId: action.id,
    flowRunId: action.flow_run_id,
    flowStepId: action.flow_step_id,
    rules: evaluation.rules,
  };

  if (evaluation.decision === "blocked" || evaluation.decision === "handoff") {
    await releaseAction(db, action, {
      status: "blocked",
      last_error: evaluation.blockedBy ?? "policy_blocked",
    });
    await recordDecision(db, {
      ...auditBase,
      decision: evaluation.decision,
      blockedBy: evaluation.blockedBy,
      reason: evaluation.reason,
    });
    if (run) {
      const isHandoff = evaluation.decision === "handoff";
      await db
        .from("followup_runs")
        .update(
          isHandoff
            ? { status: "paused", paused_at: new Date().toISOString() }
            : {
                status: "stopped",
                stopped_at: new Date().toISOString(),
                stop_reason: evaluation.blockedBy ?? "policy_blocked",
              },
        )
        .eq("id", run.id)
        .eq("status", "active");
    }
    await logEvent(db, action.user_id, {
      event_type: "automation_blocked",
      contact_id: action.contact_id,
      opportunity_id: action.opportunity_id,
      metadata: {
        scheduled_action_id: action.id,
        blocked_by: evaluation.blockedBy,
        reason: evaluation.reason,
      },
    });
    return "cancelled";
  }

  if (evaluation.decision === "deferred") {
    const target = evaluation.deferUntil
      ? new Date(evaluation.deferUntil)
      : new Date(now.getTime() + 60 * 60_000);
    const retryAt = nextAllowedInstant(target, window, settings.timezone);
    await releaseAction(db, action, {
      status: "scheduled",
      scheduled_for: retryAt.toISOString(),
      last_error: evaluation.blockedBy ?? "policy_deferred",
    });
    await recordDecision(db, {
      ...auditBase,
      decision: "deferred",
      blockedBy: evaluation.blockedBy,
      reason: evaluation.reason,
      context: { deferred_to: retryAt.toISOString() },
    });
    return "rescheduled";
  }

  // Conteúdo adaptativo (Biblioteca Estratégica) quando a etapa pede IA/material.
  const adaptive = await resolveAdaptiveContent(db, action, policy, text);

  if (adaptive.kind !== "send") {
    const decision =
      adaptive.kind === "approval_required"
        ? "approval_required"
        : adaptive.kind === "handoff"
          ? "handoff"
          : "blocked";
    await releaseAction(db, action, {
      status: "blocked",
      last_error: decision,
      draft_id: adaptive.draftId,
    });
    await recordDecision(db, {
      ...auditBase,
      decision,
      blockedBy: decision === "approval_required" ? "low_confidence" : decision,
      reason: adaptive.reason,
      confidence: adaptive.confidence,
      strategyName: adaptive.strategyName,
      strategyId: action.strategy_id,
    });
    if (run) {
      await db
        .from("followup_runs")
        .update({ status: "paused", paused_at: new Date().toISOString() })
        .eq("id", run.id)
        .eq("status", "active");
    }
    return "cancelled";
  }

  text = adaptive.text;
  const effectiveAction: ActionRow = adaptive.media
    ? {
        ...action,
        action_type: adaptive.media.actionType,
        media_reference: adaptive.media.reference,
        media_mime_type: adaptive.media.mimeType,
        media_filename: adaptive.media.filename,
      }
    : action.content_mode === "fixed_content"
      ? action
      : { ...action, action_type: "text_message", media_reference: null };

  // Modo teste: a decisão é completa, mas nada chega ao cliente.
  if (evaluation.decision === "simulated") {
    await releaseAction(db, action, {
      status: "simulated",
      simulated_at: new Date().toISOString(),
      draft_id: adaptive.draftId,
      last_error: null,
    });
    await recordDecision(db, {
      ...auditBase,
      decision: "simulated",
      blockedBy: "test_mode",
      reason: evaluation.reason,
      confidence: adaptive.confidence,
      strategyName: adaptive.strategyName,
      context: { simulated_text: text },
    });
    await logEvent(db, action.user_id, {
      event_type: "automation_simulated",
      contact_id: action.contact_id,
      opportunity_id: action.opportunity_id,
      metadata: { scheduled_action_id: action.id, preview: text },
    });
    if (run && flow) await advanceRun(db, run, flow, settings);
    return "skipped";
  }

  try {
    const sendResult = await deliverAction(db, effectiveAction, text);

    await releaseAction(db, action, {
      status: "sent",
      executed_at: new Date().toISOString(),
      message_id: sendResult.messageId,
      last_error: null,
    });

    await recordDecision(db, {
      ...auditBase,
      decision: "allowed",
      reason: evaluation.reason,
      confidence: adaptive.confidence,
      strategyName: adaptive.strategyName,
      strategyId: action.strategy_id,
      model: adaptive.model,
      promptVersion: adaptive.promptVersion,
    });

    await logEvent(db, action.user_id, {
      event_type: "scheduled_message_sent",
      contact_id: action.contact_id,
      opportunity_id: action.opportunity_id,
      metadata: {
        scheduled_action_id: action.id,
        flow_run_id: action.flow_run_id,
        conversation_id: action.conversation_id,
        action_type: action.action_type,
      },
    });

    const { writeAudit } = await import("@/lib/audit/log.server");
    await writeAudit(db, action.user_id, {
      action: "automatic_message_sent",
      summary: "Mensagem automática enviada pelo motor de follow-up.",
      entityType: "scheduled_action",
      entityId: action.id,
      actor: "system",
      metadata: { conversation_id: action.conversation_id, action_type: action.action_type },
    });

    if (run && flow) await advanceRun(db, run, flow, settings);
    return "sent";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida";

    /* Credencial recusada não é culpa da etapa: a conexão já foi marcada como
       `error` pela camada de WhatsApp. A ação volta para a fila sem consumir
       tentativa, para não matar o fluxo por um token expirado. */
    if (/credenciais/i.test(message)) {
      const retryAt = nextAllowedInstant(
        new Date(now.getTime() + DISCONNECTED_RETRY_MINUTES * 60_000),
        window,
        settings.timezone,
      );
      await releaseAction(db, action, {
        status: "scheduled",
        last_error: "whatsapp_credentials_rejected",
        scheduled_for: retryAt.toISOString(),
      });
      return "rescheduled";
    }

    const attempts = action.attempts + 1;

    if (attempts >= MAX_ATTEMPTS) {
      await failAction(db, action, run, message, true);
      return "failed";
    }

    // Backoff simples e limitado.
    const retryAt = nextAllowedInstant(
      new Date(now.getTime() + attempts * 10 * 60_000),
      window,
      settings.timezone,
    );
    await releaseAction(db, action, {
      status: "scheduled",
      attempts,
      last_error: message.slice(0, 300),
      scheduled_for: retryAt.toISOString(),
    });
    return "rescheduled";
  }
}

async function failAction(
  db: Admin,
  action: ActionRow,
  run: RunRow | null,
  message: string,
  markRunFailed: boolean,
) {
  await releaseAction(db, action, {
    status: "failed",
    attempts: Math.min(action.attempts + 1, MAX_ATTEMPTS),
    last_error: message.slice(0, 300),
  });

  if (run && markRunFailed) {
    // Não seguimos cegamente a sequência quando uma etapa falhou.
    await db
      .from("followup_runs")
      .update({
        status: "failed",
        stopped_at: new Date().toISOString(),
        stop_reason: "send_failed",
      })
      .eq("id", run.id)
      .eq("status", "active");
  }
}

/** Envio: exclusivamente pela camada interna de WhatsApp do Módulo 02. */
async function deliverAction(
  db: Admin,
  action: ActionRow,
  text: string | null,
): Promise<{ messageId: string }> {
  const { sendText, sendMedia } = await import("@/lib/whatsapp/service.server");

  if (action.action_type === "text_message") {
    if (!text) throw new Error("Ação sem conteúdo de texto");
    return sendText(action.user_id, {
      conversationId: action.conversation_id,
      text,
      source: "automation",
    });
  }

  if (!action.media_reference) throw new Error("Ação de mídia sem arquivo");
  const { MEDIA_BUCKET, STORAGE_PREFIX } = await import("@/lib/whatsapp/store.server");
  const path = action.media_reference.startsWith(STORAGE_PREFIX)
    ? action.media_reference.slice(STORAGE_PREFIX.length)
    : action.media_reference;

  const { data: file, error } = await db.storage.from(MEDIA_BUCKET).download(path);
  if (error || !file) throw new Error("Arquivo da automação indisponível");

  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);

  return sendMedia(action.user_id, {
    source: "automation",
    conversationId: action.conversation_id,
    type:
      action.action_type === "audio"
        ? "audio"
        : action.action_type === "image"
          ? "image"
          : "document",
    base64: btoa(binary),
    mimeType: action.media_mime_type ?? "application/octet-stream",
    filename: action.media_filename ?? "arquivo",
    caption: action.action_type === "document" ? null : text,
  });
}

/** Agenda a etapa seguinte ou conclui o run. */
async function advanceRun(
  db: Admin,
  run: RunRow,
  flow: FlowRow,
  settings: UserSettings,
): Promise<void> {
  const { data: steps } = await db
    .from("followup_flow_steps")
    .select("*")
    .eq("flow_id", flow.id)
    .order("position", { ascending: true });

  const ordered = steps ?? [];
  const currentIndex = ordered.findIndex((step) => step.id === run.current_step_id);
  const next = currentIndex >= 0 ? ordered[currentIndex + 1] : undefined;

  if (!next) {
    await db
      .from("followup_runs")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", run.id)
      .eq("status", "active");

    await logEvent(db, run.user_id, {
      event_type: "followup_completed",
      contact_id: run.contact_id,
      opportunity_id: run.opportunity_id,
      // Concluir significa "acabou sem resposta": não mexemos no status da
      // oportunidade.
      metadata: { flow_run_id: run.id, flow_id: flow.id, flow_name: flow.name },
    });
    return;
  }

  const now = new Date();
  await scheduleStep(db, {
    userId: run.user_id,
    run,
    flow,
    step: next,
    settings,
    from: now,
    now,
  });
}

/**
 * Reconexão do WhatsApp: reavalia ações vencidas sem disparar tudo de uma vez.
 * As ações permanecem agendadas e recebem horários espaçados dentro da janela.
 */
export async function reevaluateAfterReconnect(userId: string): Promise<{ rescheduled: number }> {
  const db = await adminClient();
  const settings = await loadUserSettings(db, userId);
  const now = new Date();
  const window = makeWindow(settings.send_window_start, settings.send_window_end);

  const { data: overdue } = await db
    .from("scheduled_actions")
    .select("id, scheduled_for, conversation_id, flow_run_id")
    .eq("user_id", userId)
    .eq("status", "scheduled")
    .lte("scheduled_for", now.toISOString())
    .order("scheduled_for", { ascending: true });

  let rescheduled = 0;
  let cursor = nextAllowedInstant(now, window, settings.timezone);

  for (const action of overdue ?? []) {
    if (action.flow_run_id) {
      const { data: run } = await db
        .from("followup_runs")
        .select("status")
        .eq("id", action.flow_run_id)
        .maybeSingle();
      if (!run || run.status !== "active") continue;
    }

    const target = nextAllowedInstant(cursor, window, settings.timezone);
    await db
      .from("scheduled_actions")
      .update({ scheduled_for: target.toISOString(), last_error: null })
      .eq("id", action.id)
      .eq("status", "scheduled");
    rescheduled += 1;
    cursor = new Date(target.getTime() + MIN_CONVERSATION_GAP_MINUTES * 60_000);
  }

  return { rescheduled };
}
