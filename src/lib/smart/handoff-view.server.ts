/** Leitura: quem conduz a conversa, por quê, e quando o agente volta. */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  HANDOFF_KIND_LABELS,
  RETURN_MODE_LABELS,
  type HandoffKind,
  type ReturnMode,
} from "./handoff";
import { RESUMABLE_SMART_STATES } from "./return.server";
import { isPostQuoteManuallyPaused } from "./post-quote-cadence";

type Client = SupabaseClient<Database>;

export interface AgentInstructionView {
  id: string;
  text: string;
  kind: string;
  reply: string | null;
  status: string;
  createdAt: string;
}

export interface AgentHandoffView {
  owner: "ai" | "human" | "none";
  hasSmartRun: boolean;
  canReturn: boolean;
  customerWaiting: boolean;
  handoff: { kind: string; label: string; at: string | null; reason: string | null } | null;
  returnPlan: {
    mode: ReturnMode;
    label: string;
    at: string | null;
    reason: string | null;
    source: string | null;
  } | null;
  analyzingAt: string | null;
  instructions: AgentInstructionView[];
}

export async function getAgentHandoffView(
  db: Client,
  conversationId: string,
): Promise<AgentHandoffView> {
  const [{ data: control }, { data: runs }, { data: instructions }] = await Promise.all([
    db.from("conversation_control").select("*").eq("conversation_id", conversationId).maybeSingle(),
    db
      .from("followup_runs")
      .select(
        "id, status, smart_state, policy_key, stop_reason, next_contact_reason, followup_flows!inner(kind)",
      )
      .eq("conversation_id", conversationId)
      .in("status", ["active", "paused"])
      .eq("followup_flows.kind", "smart"),
    db
      .from("agent_instructions")
      .select("id, text, kind, agent_reply, status, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  const smartRuns = runs ?? [];
  const canReturn = smartRuns.some(
    (run) =>
      run.status === "active" ||
      isPostQuoteManuallyPaused(run) ||
      RESUMABLE_SMART_STATES.includes(run.smart_state ?? ""),
  );
  const manuallyPaused = smartRuns.some(isPostQuoteManuallyPaused);
  const owner = (control?.owner ?? "none") as AgentHandoffView["owner"];
  const inbound = control?.last_inbound_at ?? null;
  const human = control?.last_human_message_at ?? null;
  const automation = control?.last_automation_at ?? null;
  const lastOut = [human, automation].filter(Boolean).sort().pop() ?? null;

  return {
    owner,
    hasSmartRun: smartRuns.length > 0,
    canReturn,
    customerWaiting: Boolean(inbound && (!lastOut || inbound > lastOut)),
    handoff:
      owner === "human" && control?.handoff_kind
        ? {
            kind: control.handoff_kind,
            label: HANDOFF_KIND_LABELS[control.handoff_kind as HandoffKind] ?? "Com você",
            at: control.handoff_at,
            reason: control.handoff_reason,
          }
        : null,
    returnPlan:
      !manuallyPaused && owner === "human" && control?.return_mode
        ? {
            mode: control.return_mode as ReturnMode,
            label: RETURN_MODE_LABELS[control.return_mode as ReturnMode] ?? control.return_mode,
            at: control.return_at,
            reason: control.return_reason,
            source: control.return_source,
          }
        : null,
    analyzingAt: !manuallyPaused && owner === "human" ? (control?.return_check_at ?? null) : null,
    instructions: (instructions ?? []).map((row) => ({
      id: row.id,
      text: row.text,
      kind: row.kind,
      reply: row.agent_reply,
      status: row.status,
      createdAt: row.created_at,
    })),
  };
}

export interface WaitingForYouItem {
  conversationId: string;
  contactId: string | null;
  contactName: string;
  reason: string;
  since: string | null;
  customerWaiting: boolean;
  returnLabel: string | null;
  returnAt: string | null;
}

/** "Esperando você": todo cliente com acompanhamento parado e o motivo. */
export async function listWaitingForYou(db: Client): Promise<WaitingForYouItem[]> {
  const { data: runs } = await db
    .from("followup_runs")
    .select(
      "conversation_id, contact_id, status, smart_state, paused_at, updated_at, contacts(name), followup_flows!inner(kind)",
    )
    .in("status", ["active", "paused"])
    .eq("followup_flows.kind", "smart")
    .limit(300);

  const byConversation = new Map<string, NonNullable<typeof runs>[number]>();
  for (const run of runs ?? []) {
    if (!run.conversation_id) continue;
    if (!byConversation.has(run.conversation_id)) byConversation.set(run.conversation_id, run);
  }
  const ids = [...byConversation.keys()];
  if (ids.length === 0) return [];

  const { data: controls } = await db
    .from("conversation_control")
    .select("*")
    .in("conversation_id", ids);
  const controlById = new Map((controls ?? []).map((row) => [row.conversation_id, row]));

  const items: WaitingForYouItem[] = [];
  for (const [conversationId, run] of byConversation) {
    const control = controlById.get(conversationId);
    const withYou = control?.owner === "human" || run.status === "paused";
    if (!withYou) continue;

    const inbound = control?.last_inbound_at ?? null;
    const lastOut =
      [control?.last_human_message_at, control?.last_automation_at].filter(Boolean).sort().pop() ??
      null;
    const kind = control?.handoff_kind as HandoffKind | null | undefined;

    items.push({
      conversationId,
      contactId: run.contact_id,
      contactName: (run.contacts as { name?: string } | null)?.name ?? "Cliente",
      reason:
        control?.handoff_reason ??
        (kind ? HANDOFF_KIND_LABELS[kind] : null) ??
        (run.status === "paused" ? "Acompanhamento pausado" : "Com você"),
      since: control?.handoff_at ?? run.paused_at ?? null,
      customerWaiting: Boolean(inbound && (!lastOut || inbound > lastOut)),
      returnLabel: control?.return_mode
        ? (RETURN_MODE_LABELS[control.return_mode as ReturnMode] ?? null)
        : null,
      returnAt: control?.return_at ?? null,
    });
  }

  return items.sort((a, b) => {
    if (a.customerWaiting !== b.customerWaiting) return a.customerWaiting ? -1 : 1;
    return (a.since ?? "").localeCompare(b.since ?? "");
  });
}
