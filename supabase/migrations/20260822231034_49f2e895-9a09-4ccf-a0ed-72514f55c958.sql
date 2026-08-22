create type public.followup_content_mode as enum (
  'fixed_content', 'ai_generated', 'asset_selection', 'human_required'
);

create type public.automation_decision as enum (
  'allowed', 'blocked', 'deferred', 'simulated', 'approval_required', 'handoff'
);

alter type public.scheduled_action_status add value if not exists 'blocked';
alter type public.scheduled_action_status add value if not exists 'simulated';

create table public.contact_preferences (
  contact_id uuid primary key references public.contacts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  automation_allowed boolean not null default true,
  whatsapp_allowed boolean not null default true,
  do_not_contact boolean not null default false,
  do_not_contact_reason text,
  do_not_contact_source text not null default 'human',
  contact_not_before timestamptz,
  max_automations_per_day integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.contact_preferences to authenticated;
grant all on public.contact_preferences to service_role;

alter table public.contact_preferences enable row level security;

create policy "contact_preferences_own" on public.contact_preferences
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger contact_preferences_set_updated_at
  before update on public.contact_preferences
  for each row execute function public.set_updated_at();

create or replace function public.validate_contact_preferences_ownership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.contacts c where c.id = new.contact_id and c.user_id = new.user_id
  ) then
    raise exception 'contact_id does not belong to the owning user';
  end if;
  return new;
end;
$$;

revoke execute on function public.validate_contact_preferences_ownership() from public, anon, authenticated;

create trigger contact_preferences_validate_ownership
  before insert or update on public.contact_preferences
  for each row execute function public.validate_contact_preferences_ownership();

alter table public.user_settings
  add column automation_paused boolean not null default false,
  add column automation_paused_at timestamptz,
  add column test_mode boolean not null default false,
  add column test_mode_phone text,
  add column conversation_cooldown_minutes integer not null default 180,
  add column manual_message_cooldown_minutes integer not null default 120,
  add column active_conversation_minutes integer not null default 30,
  add column max_automations_per_day integer not null default 3,
  add column max_flow_automations_per_day integer not null default 2,
  add column confidence_auto_min numeric(3,2) not null default 0.90,
  add column confidence_approval_min numeric(3,2) not null default 0.60;

create table public.automation_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  scheduled_action_id uuid references public.scheduled_actions(id) on delete set null,
  flow_run_id uuid references public.followup_runs(id) on delete set null,
  flow_step_id uuid references public.followup_flow_steps(id) on delete set null,
  decision public.automation_decision not null,
  blocked_by text,
  reason text not null,
  rules jsonb not null default '[]'::jsonb,
  context jsonb not null default '{}'::jsonb,
  strategy_id uuid references public.message_strategies(id) on delete set null,
  strategy_name text,
  strategy_version integer,
  prompt_version text,
  model text,
  confidence numeric(3,2),
  created_at timestamptz not null default now()
);

grant select on public.automation_decisions to authenticated;
grant all on public.automation_decisions to service_role;

alter table public.automation_decisions enable row level security;

create policy "automation_decisions_select_own" on public.automation_decisions
  for select to authenticated
  using (auth.uid() = user_id);

create index automation_decisions_user_created_idx
  on public.automation_decisions (user_id, created_at desc);
create index automation_decisions_contact_idx
  on public.automation_decisions (contact_id, created_at desc);

alter table public.followup_flow_steps
  add column content_mode public.followup_content_mode not null default 'fixed_content',
  add column strategy_id uuid references public.message_strategies(id) on delete set null,
  add column asset_id uuid references public.content_assets(id) on delete set null,
  add column objective text;

alter table public.scheduled_actions
  add column content_mode public.followup_content_mode not null default 'fixed_content',
  add column strategy_id uuid references public.message_strategies(id) on delete set null,
  add column draft_id uuid references public.message_drafts(id) on delete set null,
  add column simulated_at timestamptz;

create index contact_preferences_user_idx on public.contact_preferences (user_id);