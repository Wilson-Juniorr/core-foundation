import type { AutomationPolicySettings } from "./types";

export const DEFAULT_POLICY: AutomationPolicySettings = {
  automation_paused: false,
  automation_paused_at: null,
  test_mode: false,
  test_mode_phone: null,
  test_mode_allowlist: [],
  require_approval_all: false,
  conversation_cooldown_minutes: 180,
  manual_message_cooldown_minutes: 120,
  active_conversation_minutes: 30,
  max_automations_per_day: 3,
  max_flow_automations_per_day: 2,
  confidence_auto_min: 0.9,
  confidence_approval_min: 0.6,
};
