import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  contactArchiveSchema,
  contactInputSchema,
  contactSignalsSchema,
  contactUpdateSchema,
  contactVisionSchema,
  duplicateLookupSchema,
  idSchema,
  listContactsSchema,
  opportunityInputSchema,
  opportunityUpdateSchema,
} from "./crm.schemas";
import type { Database } from "@/integrations/supabase/types";
import type {
  Contact,
  ContactDetail,
  ContactSignal,
  DashboardMetrics,
  OpportunityWithRelations,
  PipelineStage,
  TimelineEvent,
} from "./crm.types";

import type { ExtractedContact } from "./crm/contact-vision.server";

export const listContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => listContactsSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<Contact[]> => {
    let query = context.supabase
      .from("contacts")
      .select("*")
      .order("created_at", { ascending: false });

    if (!data.includeArchived) query = query.eq("is_archived", false);

    if (data.search) {
      const term = `%${data.search}%`;
      query = query.or(`name.ilike.${term},phone.ilike.${term},email.ilike.${term}`);
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows as Contact[];
  });

export const getContactDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }): Promise<ContactDetail> => {
    const { OPPORTUNITY_SELECT, mapOpportunity } = await import("./crm.server");

    const [contactResult, opportunitiesResult, timelineResult] = await Promise.all([
      context.supabase.from("contacts").select("*").eq("id", data.id).maybeSingle(),
      context.supabase
        .from("opportunities")
        .select(OPPORTUNITY_SELECT)
        .eq("contact_id", data.id)
        .order("created_at", { ascending: false }),
      context.supabase
        .from("timeline_events")
        .select("id, event_type, opportunity_id, metadata, created_at")
        .eq("contact_id", data.id)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (contactResult.error) throw new Error(contactResult.error.message);
    if (!contactResult.data) throw new Error("Cliente não encontrado");
    if (opportunitiesResult.error) throw new Error(opportunitiesResult.error.message);
    if (timelineResult.error) throw new Error(timelineResult.error.message);

    return {
      contact: contactResult.data as Contact,
      opportunities: opportunitiesResult.data.map(mapOpportunity),
      timeline: timelineResult.data as TimelineEvent[],
    };
  });

/** Avisa, antes de salvar, que já existe cliente com o mesmo telefone/e-mail. */
export const findDuplicateContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => duplicateLookupSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<Contact[]> => {
    const { findDuplicateContacts: find } = await import("./crm.server");
    return find(context.supabase, {
      phone: data.phone ?? null,
      email: data.email ?? null,
      excludeId: data.excludeId ?? null,
    });
  });

/**
 * Sinais do dia a dia por cliente: acompanhamento em andamento, etapas
 * bloqueadas e última resposta recebida. Evita iniciar fluxo duplicado ou
 * automatizar alguém que acabou de responder.
 */
export const getContactSignals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => contactSignalsSchema.parse(input))
  .handler(async ({ data, context }): Promise<ContactSignal[]> => {
    const ids = data.contactIds;

    const [runsResult, blockedResult, inboundResult] = await Promise.all([
      context.supabase
        .from("followup_runs")
        .select("contact_id, status")
        .in("contact_id", ids)
        .in("status", ["active", "paused"]),
      context.supabase
        .from("scheduled_actions")
        .select("contact_id")
        .in("contact_id", ids)
        .eq("status", "blocked"),
      context.supabase
        .from("messages")
        .select("contact_id, sent_at")
        .in("contact_id", ids)
        .eq("direction", "inbound")
        .order("sent_at", { ascending: false })
        .limit(500),
    ]);

    const signals = new Map<string, ContactSignal>(
      ids.map((id) => [
        id,
        { contact_id: id, followup_status: null, blocked_actions: 0, last_inbound_at: null },
      ]),
    );

    for (const run of runsResult.data ?? []) {
      if (!run.contact_id) continue;
      const signal = signals.get(run.contact_id);
      if (!signal) continue;
      // "active" tem precedência sobre "paused" na exibição.
      if (signal.followup_status !== "active") {
        signal.followup_status = run.status === "active" ? "active" : "paused";
      }
    }

    for (const action of blockedResult.data ?? []) {
      if (!action.contact_id) continue;
      const signal = signals.get(action.contact_id);
      if (signal) signal.blocked_actions += 1;
    }

    for (const message of inboundResult.data ?? []) {
      if (!message.contact_id) continue;
      const signal = signals.get(message.contact_id);
      if (signal && !signal.last_inbound_at) signal.last_inbound_at = message.sent_at;
    }

    return [...signals.values()];
  });

export const createContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => contactInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<Contact> => {
    const { normalizePhone } = await import("./domain/phone");
    const { findDuplicateContacts: find, logEvent } = await import("./crm.server");

    // Rede de segurança contra duplo clique/corrida: o aviso da tela é a
    // primeira barreira, esta é a definitiva.
    if (!data.allow_duplicate) {
      const duplicates = await find(context.supabase, { phone: data.phone, email: data.email });
      if (duplicates.length > 0) {
        throw new Error(
          `Já existe um cliente com este contato: ${duplicates.map((item) => item.name).join(", ")}.`,
        );
      }
    }

    const { data: row, error } = await context.supabase
      .from("contacts")
      .insert({
        user_id: context.userId,
        name: data.name,
        phone: normalizePhone(data.phone),
        email: data.email,
        source: data.source,
        notes: data.notes,
      })
      .select("*")
      .single();

    if (error) throw new Error(error.message);

    await logEvent(context.supabase, context.userId, {
      event_type: "contact_created",
      contact_id: row.id,
      metadata: { name: row.name },
    });

    // Cadastro por print: já cria a oportunidade na primeira etapa do pipeline.
    if (data.create_opportunity) {
      const { data: firstStage } = await context.supabase
        .from("pipeline_stages")
        .select("id, name")
        .eq("is_active", true)
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (firstStage) {
        const title = data.opportunity_title?.trim() || `${row.name} — Novo negócio`;
        const { data: oppRow, error: oppError } = await context.supabase
          .from("opportunities")
          .insert({
            user_id: context.userId,
            contact_id: row.id,
            pipeline_stage_id: firstStage.id,
            title,
            status: "open",
          })
          .select("id")
          .single();

        if (oppError) {
          console.error("Falha ao criar oportunidade automática", oppError.message);
        } else {
          await logEvent(context.supabase, context.userId, {
            event_type: "opportunity_created",
            contact_id: row.id,
            opportunity_id: oppRow.id,
            metadata: { title, stage_name: firstStage.name },
          });
        }
      }
    }

    return row as Contact;
  });

/** Cadastro por print: lê as imagens e devolve os campos do cliente para revisão. */
export const extractContactFromImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => contactVisionSchema.parse(input))
  .handler(async ({ data, context }): Promise<ExtractedContact> => {
    const { extractContactFromImages } = await import("./crm/contact-vision.server");
    return extractContactFromImages(context.userId, data.images);
  });

export const updateContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => contactUpdateSchema.parse(input))
  .handler(async ({ data, context }): Promise<Contact> => {
    const { normalizePhone } = await import("./domain/phone");
    const { logEvent } = await import("./crm.server");

    const { data: row, error } = await context.supabase
      .from("contacts")
      .update({
        name: data.name,
        phone: normalizePhone(data.phone),
        email: data.email,
        source: data.source,
        notes: data.notes,
      })
      .eq("id", data.id)
      .select("*")
      .single();

    if (error) throw new Error(error.message);

    await logEvent(context.supabase, context.userId, {
      event_type: "contact_updated",
      contact_id: row.id,
      metadata: { name: row.name },
    });

    return row as Contact;
  });

export const setContactArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => contactArchiveSchema.parse(input))
  .handler(async ({ data, context }): Promise<Contact> => {
    const { logEvent } = await import("./crm.server");

    const { data: row, error } = await context.supabase
      .from("contacts")
      .update({ is_archived: data.is_archived })
      .eq("id", data.id)
      .select("*")
      .single();

    if (error) throw new Error(error.message);

    await logEvent(context.supabase, context.userId, {
      event_type: data.is_archived ? "contact_archived" : "contact_restored",
      contact_id: row.id,
    });

    return row as Contact;
  });

export const listPipelineStages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PipelineStage[]> => {
    const { data, error } = await context.supabase
      .from("pipeline_stages")
      .select("id, name, position, is_active")
      .eq("is_active", true)
      .order("position", { ascending: true });

    if (error) throw new Error(error.message);
    return data as PipelineStage[];
  });

export const listOpportunities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OpportunityWithRelations[]> => {
    const { OPPORTUNITY_SELECT, mapOpportunity } = await import("./crm.server");

    const { data, error } = await context.supabase
      .from("opportunities")
      .select(OPPORTUNITY_SELECT)
      .in("status", ["open", "won", "lost"])
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return data.map(mapOpportunity);
  });

export const createOpportunity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => opportunityInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<OpportunityWithRelations> => {
    const { OPPORTUNITY_SELECT, mapOpportunity, logEvent } = await import("./crm.server");

    const { data: row, error } = await context.supabase
      .from("opportunities")
      .insert({
        user_id: context.userId,
        contact_id: data.contact_id,
        pipeline_stage_id: data.pipeline_stage_id,
        title: data.title,
        estimated_value: data.estimated_value ?? null,
        next_action_description: data.next_action_description,
        next_action_at: data.next_action_at ?? null,
        notes: data.notes,
      })
      .select(OPPORTUNITY_SELECT)
      .single();

    if (error) throw new Error(error.message);

    const opportunity = mapOpportunity(row);

    await logEvent(context.supabase, context.userId, {
      event_type: "opportunity_created",
      contact_id: opportunity.contact_id,
      opportunity_id: opportunity.id,
      metadata: { title: opportunity.title, stage_name: opportunity.stage_name },
    });

    return opportunity;
  });

export const updateOpportunity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => opportunityUpdateSchema.parse(input))
  .handler(async ({ data, context }): Promise<OpportunityWithRelations> => {
    const { OPPORTUNITY_SELECT, mapOpportunity, logOpportunityChanges } =
      await import("./crm.server");

    const { id, ...changes } = data;
    const patch = Object.fromEntries(
      Object.entries(changes).filter(([, value]) => value !== undefined),
    ) as Database["public"]["Tables"]["opportunities"]["Update"];

    const { data: before, error: beforeError } = await context.supabase
      .from("opportunities")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (beforeError) throw new Error(beforeError.message);
    if (!before) throw new Error("Oportunidade não encontrada");

    const { data: row, error } = await context.supabase
      .from("opportunities")
      .update(patch)
      .eq("id", id)
      .select(OPPORTUNITY_SELECT)
      .single();

    if (error) throw new Error(error.message);

    const after = mapOpportunity(row);

    const { data: stages } = await context.supabase.from("pipeline_stages").select("id, name");
    const stageNames = new Map((stages ?? []).map((stage) => [stage.id, stage.name]));

    await logOpportunityChanges(
      context.supabase,
      context.userId,
      {
        ...before,
        estimated_value: before.estimated_value === null ? null : Number(before.estimated_value),
      },
      after,
      stageNames,
    );

    return after;
  });

export const getDashboardMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardMetrics> => {
    const { OPPORTUNITY_SELECT, mapOpportunity } = await import("./crm.server");
    const { needsAttention, classifyNextAction } = await import("./domain/next-action");

    const [contactsResult, openResult] = await Promise.all([
      context.supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("is_archived", false),
      context.supabase.from("opportunities").select(OPPORTUNITY_SELECT).eq("status", "open"),
    ]);

    if (contactsResult.error) throw new Error(contactsResult.error.message);
    if (openResult.error) throw new Error(openResult.error.message);

    const open = openResult.data.map(mapOpportunity);

    return {
      activeContacts: contactsResult.count ?? 0,
      openOpportunities: open.length,
      withoutNextAction: open.filter((item) => item.next_action_at === null).length,
      dueToday: open.filter((item) => classifyNextAction(item.next_action_at) === "today").length,
      attention: open
        .filter((item) => needsAttention(item.next_action_at))
        .sort((a, b) => (a.next_action_at ?? "").localeCompare(b.next_action_at ?? "")),
    };
  });
