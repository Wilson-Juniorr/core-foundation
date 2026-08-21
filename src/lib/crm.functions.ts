import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  contactArchiveSchema,
  contactInputSchema,
  contactUpdateSchema,
  idSchema,
  listContactsSchema,
  opportunityInputSchema,
  opportunityUpdateSchema,
} from "./crm.schemas";
import type { Database } from "@/integrations/supabase/types";
import type {
  Contact,
  ContactDetail,
  DashboardMetrics,
  OpportunityWithRelations,
  PipelineStage,
  TimelineEvent,
} from "./crm.types";

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

export const createContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => contactInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<Contact> => {
    const { normalizePhone } = await import("./domain/phone");
    const { logEvent } = await import("./crm.server");

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

    return row as Contact;
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
    const { OPPORTUNITY_SELECT, mapOpportunity, logOpportunityChanges } = await import(
      "./crm.server"
    );

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

    const { data: stages } = await context.supabase
      .from("pipeline_stages")
      .select("id, name");
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
