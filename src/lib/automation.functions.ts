import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  automationPolicySchema,
  contactPreferencesSchema,
  decisionListSchema,
  emergencyStopSchema,
} from "./automation.schemas";
import type {
  AutomationDecisionView,
  AutomationPolicySettings,
  ContactPreferences,
  PolicyRuleResult,
} from "./automation/types";

const POLICY_COLUMNS =
  "automation_paused, automation_paused_at, test_mode, test_mode_phone, conversation_cooldown_minutes, manual_message_cooldown_minutes, active_conversation_minutes, max_automations_per_day, max_flow_automations_per_day, confidence_auto_min, confidence_approval_min";

export const getAutomationPolicy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AutomationPolicySettings> => {
    const { DEFAULT_POLICY } = await import("./automation/policy.defaults");
    const { data } = await context.supabase
      .from("user_settings")
      .select(POLICY_COLUMNS)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!data) return { ...DEFAULT_POLICY };
    return {
      automation_paused: data.automation_paused,
      automation_paused_at: data.automation_paused_at,
      test_mode: data.test_mode,
      test_mode_phone: data.test_mode_phone,
      conversation_cooldown_minutes: data.conversation_cooldown_minutes,
      manual_message_cooldown_minutes: data.manual_message_cooldown_minutes,
      active_conversation_minutes: data.active_conversation_minutes,
      max_automations_per_day: data.max_automations_per_day,
      max_flow_automations_per_day: data.max_flow_automations_per_day,
      confidence_auto_min: Number(data.confidence_auto_min),
      confidence_approval_min: Number(data.confidence_approval_min),
    };
  });

export const saveAutomationPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => automationPolicySchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    if (data.confidence_approval_min > data.confidence_auto_min) {
      throw new Error("O limite de aprovação deve ser menor ou igual ao de envio automático.");
    }
    const { error } = await context.supabase
      .from("user_settings")
      .upsert({ user_id: context.userId, ...data }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setEmergencyStop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => emergencyStopSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ paused: boolean }> => {
    const { error } = await context.supabase.from("user_settings").upsert(
      {
        user_id: context.userId,
        automation_paused: data.paused,
        automation_paused_at: data.paused ? new Date().toISOString() : null,
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { paused: data.paused };
  });

export const getContactPreferences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { contactId: string }) => input)
  .handler(async ({ data, context }): Promise<ContactPreferences> => {
    const { data: row } = await context.supabase
      .from("contact_preferences")
      .select(
        "contact_id, automation_allowed, whatsapp_allowed, do_not_contact, do_not_contact_reason, do_not_contact_source, contact_not_before, max_automations_per_day",
      )
      .eq("contact_id", data.contactId)
      .maybeSingle();

    return (
      row ?? {
        contact_id: data.contactId,
        automation_allowed: true,
        whatsapp_allowed: true,
        do_not_contact: false,
        do_not_contact_reason: null,
        do_not_contact_source: "human",
        contact_not_before: null,
        max_automations_per_day: null,
      }
    );
  });

export const saveContactPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => contactPreferencesSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.from("contact_preferences").upsert(
      {
        ...data,
        user_id: context.userId,
        do_not_contact_source: "human",
      },
      { onConflict: "contact_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listAutomationDecisions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => decisionListSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<AutomationDecisionView[]> => {
    let query = context.supabase
      .from("automation_decisions")
      .select(
        "id, created_at, decision, reason, blocked_by, contact_id, strategy_name, confidence, model, rules, contacts(name)",
      )
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.contactId) query = query.eq("contact_id", data.contactId);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    return (rows ?? []).map((row) => ({
      id: row.id,
      created_at: row.created_at,
      decision: row.decision,
      reason: row.reason,
      blocked_by: row.blocked_by,
      contact_id: row.contact_id,
      contact_name: (row.contacts as { name: string } | null)?.name ?? null,
      strategy_name: row.strategy_name,
      confidence: row.confidence != null ? Number(row.confidence) : null,
      model: row.model,
      rules: (row.rules ?? []) as unknown as PolicyRuleResult[],
    }));
  });
