import type { OpportunityStatus } from "./domain/opportunity-status";

export type Contact = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  notes: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};

export type PipelineStage = {
  id: string;
  name: string;
  position: number;
  is_active: boolean;
};

export type Opportunity = {
  id: string;
  contact_id: string;
  pipeline_stage_id: string;
  title: string;
  status: OpportunityStatus;
  estimated_value: number | null;
  next_action_description: string | null;
  next_action_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/** Oportunidade acompanhada dos rótulos usados nas listagens e no pipeline. */
export type OpportunityWithRelations = Opportunity & {
  contact_name: string;
  stage_name: string;
};

export type TimelineEvent = {
  id: string;
  event_type: string;
  opportunity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ContactDetail = {
  contact: Contact;
  opportunities: OpportunityWithRelations[];
  timeline: TimelineEvent[];
};

export type DashboardMetrics = {
  activeContacts: number;
  openOpportunities: number;
  withoutNextAction: number;
  dueToday: number;
  attention: OpportunityWithRelations[];
};
