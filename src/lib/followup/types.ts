import type { Database } from "@/integrations/supabase/types";

export type DelayUnit = Database["public"]["Enums"]["followup_delay_unit"];
export type FollowupActionType = Database["public"]["Enums"]["followup_action_type"];
export type FollowupRunStatus = Database["public"]["Enums"]["followup_run_status"];
export type ScheduledActionStatus = Database["public"]["Enums"]["scheduled_action_status"];

export interface FlowStep {
  id: string;
  flow_id: string;
  position: number;
  delay_value: number;
  delay_unit: DelayUnit;
  action_type: FollowupActionType;
  content: string | null;
  media_reference: string | null;
  media_mime_type: string | null;
  media_filename: string | null;
  preferred_time_start: string | null;
  preferred_time_end: string | null;
}

export interface Flow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  stop_on_reply: boolean;
  window_start: string | null;
  window_end: string | null;
  step_count: number;
  active_runs: number;
  updated_at: string;
}

export interface FlowDetail extends Flow {
  steps: FlowStep[];
}

export interface ScheduledActionView {
  id: string;
  flow_run_id: string | null;
  flow_step_id: string | null;
  contact_id: string | null;
  contact_name: string | null;
  conversation_id: string;
  action_type: FollowupActionType;
  content: string | null;
  media_filename: string | null;
  scheduled_for: string;
  status: ScheduledActionStatus;
  cancel_on_reply: boolean;
  attempts: number;
  last_error: string | null;
  executed_at: string | null;
}

export interface FollowupRunView {
  id: string;
  flow_id: string;
  flow_name: string;
  contact_id: string;
  contact_name: string | null;
  conversation_id: string;
  opportunity_id: string | null;
  status: FollowupRunStatus;
  current_step_position: number | null;
  total_steps: number;
  remaining_steps: number;
  started_at: string;
  paused_at: string | null;
  stopped_at: string | null;
  completed_at: string | null;
  stop_reason: string | null;
  next_action: ScheduledActionView | null;
}

export interface FollowupSummary {
  run: FollowupRunView | null;
  /** Último run encerrado, usado para mensagens discretas na conversa. */
  last_stopped_run: FollowupRunView | null;
  scheduled: ScheduledActionView[];
}

export interface UserSettings {
  timezone: string;
  send_window_start: string;
  send_window_end: string;
}

export interface StartFlowPreview {
  flow_name: string;
  step_count: number;
  first_action_type: FollowupActionType;
  first_action_at: string;
  first_action_content: string | null;
}
