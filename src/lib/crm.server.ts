import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import type { TimelineEventType } from "./domain/events";
import type { Contact, Opportunity, OpportunityWithRelations } from "./crm.types";

type Client = SupabaseClient<Database>;

export const OPPORTUNITY_SELECT = "*, contacts(name), pipeline_stages(name)";

type OpportunityRow = Database["public"]["Tables"]["opportunities"]["Row"] & {
  contacts: { name: string } | null;
  pipeline_stages: { name: string } | null;
};

export function mapOpportunity(row: OpportunityRow): OpportunityWithRelations {
  return {
    id: row.id,
    contact_id: row.contact_id,
    pipeline_stage_id: row.pipeline_stage_id,
    title: row.title,
    status: row.status,
    estimated_value: row.estimated_value === null ? null : Number(row.estimated_value),
    next_action_description: row.next_action_description,
    next_action_at: row.next_action_at,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    contact_name: row.contacts?.name ?? "—",
    stage_name: row.pipeline_stages?.name ?? "—",
  };
}

/** Falhas de auditoria não devem derrubar a operação principal do usuário. */
export async function logEvent(
  supabase: Client,
  userId: string,
  event: {
    event_type: TimelineEventType;
    contact_id: string | null;
    opportunity_id?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabase.from("timeline_events").insert({
    user_id: userId,
    contact_id: event.contact_id,
    opportunity_id: event.opportunity_id ?? null,
    event_type: event.event_type,
    metadata: (event.metadata ??
      {}) as Database["public"]["Tables"]["timeline_events"]["Row"]["metadata"],
  });

  if (error) console.error("Falha ao registrar evento de timeline", error);
}

/**
 * Deriva os eventos de timeline a partir da diferença entre a oportunidade
 * antes e depois da atualização.
 */
export async function logOpportunityChanges(
  supabase: Client,
  userId: string,
  before: Opportunity,
  after: OpportunityWithRelations,
  stageNames: Map<string, string>,
): Promise<void> {
  if (before.pipeline_stage_id !== after.pipeline_stage_id) {
    await logEvent(supabase, userId, {
      event_type: "stage_changed",
      contact_id: after.contact_id,
      opportunity_id: after.id,
      metadata: {
        from_stage_id: before.pipeline_stage_id,
        to_stage_id: after.pipeline_stage_id,
        from_stage_name: stageNames.get(before.pipeline_stage_id) ?? null,
        to_stage_name: after.stage_name,
      },
    });
  }

  if (
    before.next_action_at !== after.next_action_at ||
    before.next_action_description !== after.next_action_description
  ) {
    await logEvent(supabase, userId, {
      event_type: "next_action_updated",
      contact_id: after.contact_id,
      opportunity_id: after.id,
      metadata: {
        next_action_description: after.next_action_description,
        next_action_at: after.next_action_at,
      },
    });
  }

  if (before.status !== after.status) {
    const statusEvent: TimelineEventType | null =
      after.status === "won"
        ? "opportunity_won"
        : after.status === "lost"
          ? "opportunity_lost"
          : "opportunity_updated";

    await logEvent(supabase, userId, {
      event_type: statusEvent,
      contact_id: after.contact_id,
      opportunity_id: after.id,
      metadata: { from_status: before.status, to_status: after.status },
    });
  }
}

/**
 * Duplicidade de cadastro é um problema de dia a dia: o mesmo lead volta por
 * outro canal e vira dois clientes. Comparamos pelo telefone normalizado
 * (E.164) e pelo e-mail, para que "(11) 91238-9903" e "11912389903" sejam
 * reconhecidos como o mesmo número.
 */
export async function findDuplicateContacts(
  supabase: Client,
  input: { phone?: string | null; email?: string | null; excludeId?: string | null },
): Promise<Contact[]> {
  const { normalizePhone } = await import("./domain/phone");

  const phone = normalizePhone(input.phone ?? null);
  const email = input.email?.trim().toLowerCase() || null;
  if (!phone && !email) return [];

  const found = new Map<string, Contact>();

  if (phone) {
    const { data } = await supabase.from("contacts").select("*").eq("phone", phone).limit(5);
    for (const row of data ?? []) found.set(row.id, row as Contact);
  }

  if (email) {
    const { data } = await supabase.from("contacts").select("*").ilike("email", email).limit(5);
    for (const row of data ?? []) found.set(row.id, row as Contact);
  }

  if (input.excludeId) found.delete(input.excludeId);
  return [...found.values()];
}
